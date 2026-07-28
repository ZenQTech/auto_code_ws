# P1-10 Verification Loop - 验收清单

> **关联 Spec**: [./spec.md](./spec.md)
> **关联任务**: [./task.md](./task.md)
> **版本**: v1.0.0

---

## 一、后端功能验收

### 1.1 核心服务
- [ ] `backend/app/services/verification.py` 核心服务实现
- [ ] VerificationTask / VerificationResult / FixAction 数据类完整
- [ ] DIMENSIONS 字典定义 4 维度
- [ ] TriggerType / Status 枚举
- [ ] 错误分类（5 类）
- [ ] 4 维度验证器（Syntax / Module / Integration / Performance）
- [ ] VerificationTaskManager（CRUD + 幂等 + 状态流转）
- [ ] VerificationResultStore（JSONL 存储 + 索引）
- [ ] FixOrchestrator（错误分类 + agent 路由 + 重试）
- [ ] BaselineStore（基线管理 + 对比 + 失效）
- [ ] ReportGenerator（Markdown / JSON / HTML）
- [ ] WebhookHandler（git push / PR 解析）

### 1.2 API 端点
- [ ] `POST /api/verification/tasks` 创建任务
- [ ] `GET /api/verification/tasks` 列出任务
- [ ] `GET /api/verification/tasks/{id}` 任务详情
- [ ] `POST /api/verification/tasks/{id}/run` 立即执行
- [ ] `POST /api/verification/tasks/{id}/cancel` 取消任务
- [ ] `POST /api/verification/tasks/{id}/retry` 重试任务
- [ ] `GET /api/verification/results/{task_id}` 获取结果
- [ ] `GET /api/verification/baselines` 基线列表
- [ ] `POST /api/verification/baselines` 创建基线
- [ ] `GET /api/verification/stats` 统计信息
- [ ] `GET /api/verification/health` 健康检查
- [ ] `POST /api/verification/webhook/git` Webhook 触发
- [ ] 路由注册到 main.py v6.10.0

### 1.3 安全要求
- [ ] 验证命令白名单（防止命令注入）
- [ ] 项目路径白名单（限制 4 个工作区）
- [ ] commit SHA 校验（40 字符 hex）
- [ ] 结果完整性（SHA-256 校验和）
- [ ] 敏感信息过滤（API Key / token / 密码）
- [ ] 线程安全（RLock）

---

## 二、前端功能验收

### 2.1 API Hook
- [ ] `useVerificationApi.ts` 完整封装
- [ ] 类型定义完整
- [ ] 12+ API 方法

### 2.2 组件
- [ ] `VerificationPanel.tsx` 主面板
- [ ] `VerificationStatusBadge.tsx` 状态徽章
- [ ] `VerificationPage.tsx` 独立访问页
- [ ] `/verification` 路由注册
- [ ] BrandHeader 菜单项
- [ ] TypeScript 编译 0 errors

### 2.3 交互功能
- [ ] 任务列表显示 + 过滤
- [ ] 任务详情（维度结果 + 修复记录）
- [ ] 创建任务对话框
- [ ] 实时进度（轮询）
- [ ] 报告查看器（3 种格式切换）
- [ ] 性能基线管理

---

## 三、测试覆盖验收

### 3.1 单元测试
- [ ] `tests/test_verification_units.py` 80+ 用例 100% 通过
- [ ] TestDataClasses 8 用例
- [ ] TestSyntaxVerifier 8 用例
- [ ] TestModuleVerifier 8 用例
- [ ] TestIntegrationVerifier 8 用例
- [ ] TestPerformanceVerifier 8 用例
- [ ] TestTaskManager 10 用例
- [ ] TestFixOrchestrator 10 用例
- [ ] TestBaselineStore 8 用例
- [ ] TestReportGenerator 8 用例
- [ ] TestWebhookHandler 5 用例
- [ ] TestSecurity 5 用例

### 3.2 E2E 测试
- [ ] `tests/test_e2e_verification.sh` 10+ 模块 100% 通过
- [ ] 健康检查
- [ ] 创建验证任务（4 种 trigger）
- [ ] 任务列表 / 详情
- [ ] 立即执行 / 取消 / 重试
- [ ] 结果查询
- [ ] 性能基线
- [ ] Webhook 触发
- [ ] 统计信息
- [ ] 异常路径（命令注入 / 路径越界）

### 3.3 集成测试
- [ ] `tests/test_verification_integration.py` 4 个链路 100% 通过
- [ ] commit → verification → fix → retry → passed
- [ ] 性能退化告警
- [ ] 高风险模块零容忍
- [ ] Webhook 触发

### 3.4 性能压测
- [ ] `tests/benchmarks/verification_load.py` 100 并发 < 30min
- [ ] 1000 任务存储 < 100MB

---

## 四、性能与可靠性验收

### 4.1 性能指标
- [ ] 创建任务 P99 < 100ms
- [ ] syntax 验证 P99 < 30s
- [ ] module 验证 P99 < 5min
- [ ] integration 验证 P99 < 20min
- [ ] report 生成 P99 < 5s
- [ ] 存储 1000 任务 < 100MB

### 4.2 可靠性
- [ ] 后台 worker 故障自动重启
- [ ] 存储损坏检测 + 告警
- [ ] 超时保护（每维度有 timeout_seconds）
- [ ] 幂等性（同 commit+dims 不重复）

---

## 五、集成验收

### 5.1 与现有系统联动
- [ ] CommitHookHandler 触发 → Verification Task
- [ ] Verification 完成 → AtomicTaskAggregator 通知
- [ ] Verification 失败 → Memory System 写入 pattern（self-improvement）
- [ ] Multi-Agent v2 调用 fix agent
- [ ] WorkflowEngine 验证完成推进

### 5.2 高风险模块零容忍
- [ ] motion_control / collision_detection / emergency_stop 模块 safety verification 强制通过
- [ ] safety 失败 → 阻止 commit
- [ ] 错误信息 `high_risk_blocked`

---

## 六、用户场景验收

### 6.1 场景 1：commit 触发自动验证
- [ ] 在 backend 修改任意 Python 文件
- [ ] 执行 `git commit -m "test"`
- [ ] 等待 10s
- [ ] 验证：verification task 创建成功 + syntax 通过
- [ ] 期望：`status: passed`、`syntax.duration_seconds < 30`

### 6.2 场景 2：失败自动修复
- [ ] 在某个模块故意引入 type error
- [ ] 执行 `git commit`
- [ ] 等待验证失败
- [ ] 验证：fix agent 被调用 + 修复后重新验证
- [ ] 期望：`retry_count: 1` + `status: passed`（如果修复成功）

### 6.3 场景 3：性能基线对比
- [ ] 创建性能基线
- [ ] 在某个热路径加 100ms 延迟
- [ ] 触发性能验证
- [ ] 验证：性能退化 > 5% → 失败
- [ ] 期望：`dimension: performance` + `status: failed` + 退化告警

### 6.4 场景 4：定时全量回归
- [ ] 配置 cron 任务（每日 02:00）
- [ ] 等待触发
- [ ] 验证：所有项目全量验证
- [ ] 期望：生成完整回归报告 + 通知管理员

### 6.5 场景 5：高风险模块零容忍
- [ ] 在 motion_control 模块引入未通过 safety verification 的代码
- [ ] 触发验证
- [ ] 验证：safety 维度失败 → 强制阻止 commit
- [ ] 期望：`status: failed` + `error: "high_risk_blocked"`

---

## 七、浏览器端实测验收

通过 MCP 浏览器访问 /verification 页面，验证：

- [ ] 任务列表展示
- [ ] 任务详情展示
- [ ] 创建任务表单
- [ ] 报告查看器（3 种格式）
- [ ] 性能基线管理
- [ ] 实时进度展示

---

## 八、文档验收

- [ ] `CYCLE10_P1_10_SUMMARY.md` 实现总结
- [ ] `CYCLE10_P1_10_UI_SUMMARY.md` UI 集成总结
- [ ] `代码修改日志.md` 更新到 v6.10.0
- [ ] Spec / Task / Checklist 三件套完整

---

## 九、最终交付

- [ ] 100% 测试通过
- [ ] 100% 验收清单通过
- [ ] 100% 文档完整
- [ ] 无 P0/P1 bug
- [ ] 清理测试脚本与临时文件
- [ ] 准备进入下一轮循环（Phase 5 UI/UX 优化 或 P1-11+）
