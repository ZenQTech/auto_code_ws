# Cycle 33 差距分析报告

**周期**：Cycle 33 (v6.92.0+)  
**日期**：2026-07-30  
**方向**：跨产品集成 + 端到端企业 Demo  
**参考文档**：[CYCLE33_CODEX_TRAE_RESEARCH.md](./CYCLE33_CODEX_TRAE_RESEARCH.md)

---

## 一、调研结论

基于 Cycle 33 互联网调研，Hermes 当前在"端到端企业场景"维度的**核心差距**集中在三个能力：

1. **企业全场景工作流** — 缺少开箱即用的企业级场景模板
2. **统一 Dashboard** — 30+ 引擎的指标分散，无统一视图
3. **安全审计场景** — 无自动化的攻击场景演练

---

## 二、差距维度分析

### 2.1 企业全场景工作流维度

| 维度 | Hermes 现状 | 目标状态 | 差距 |
|------|------------|---------|------|
| **场景模板** | 无 | 5+ 企业场景 | 高 |
| **声明式 DSL** | DynamicWorkflow 支持 Phase | JSON 工作流定义 | 中 |
| **引擎编排** | 各引擎独立 | 30+ 引擎协同 | 高 |
| **状态可视化** | 基础 | 时间轴 + DAG | 中 |
| **错误处理** | Try-catch | 自动重试 + 回滚 | 中 |
| **人类介入** | 无 | 审批节点 | 中 |
| **子工作流** | 支持 | 嵌套调用 | 低 |
| **超时控制** | 基础 | 细粒度 | 中 |
| **审计日志** | 有 | 完整链路 | 中 |
| **版本管理** | 无 | 多版本切换 | 中 |

### 2.2 统一 Dashboard 维度

| 维度 | Hermes 现状 | 目标状态 | 差距 |
|------|------------|---------|------|
| **统一入口** | 无 | 单一 Dashboard | 高 |
| **实时刷新** | 无 | WebSocket 推送 | 高 |
| **多面板布局** | 无 | Grid 系统 | 高 |
| **关键指标** | 各引擎分散 | 聚合展示 | 高 |
| **时间序列** | 无 | 折线/热力图 | 高 |
| **告警徽章** | 无 | 异常高亮 | 中 |
| **下钻分析** | 无 | 点击查看详情 | 中 |
| **自定义查询** | 无 | 表达式过滤 | 中 |
| **导出报告** | 各引擎独立 | 统一导出 | 中 |
| **暗色主题** | 部分 | 完整支持 | 低 |

### 2.3 安全审计场景维度

| 维度 | Hermes 现状 | 目标状态 | 差距 |
|------|------------|---------|------|
| **攻击场景库** | 无 | 7+ 预置场景 | 高 |
| **自动执行** | 无 | 一键启动 | 高 |
| **预期验证** | 无 | 自动化断言 | 高 |
| **报告生成** | 无 | PDF + 结构化 | 高 |
| **CI/CD 集成** | 无 | 流水线集成 | 中 |
| **应急响应** | 无 | 预置流程 | 中 |
| **证据收集** | 无 | 自动化 | 中 |
| **演练记录** | 无 | 完整回放 | 中 |

---

## 三、P0 任务清单

### 3.1 G33-01 EnterpriseWorkflowEngine

**目标**：实现企业级工作流编排引擎，集成 30+ 引擎作为工作流步骤。

**核心 API**：
- 场景模板管理：registerTemplate / listTemplates / applyTemplate
- 工作流执行：execute / executeWithContext / pause / resume / cancel
- 状态查询：getWorkflow / getStep / getExecutionLog
- 版本管理：publishVersion / rollbackToVersion

**5 个预置场景**：
1. **用户入职**（user-onboarding）：SSO 创建用户 → SCIM 同步 → 分配角色 → 通知团队
2. **代码审查**（code-review）：PR 创建 → 自动代码评审 → 测试运行 → 审计记录 → 通知审查者
3. **合规审计**（compliance-audit）：生成 SOC 2 报告 → 拉取审计事件 → 验证完整性 → 导出 PDF → 归档
4. **安全应急**（security-incident）：检测异常 → 触发策略 → 隔离用户 → 通知 SOC → 启动应急流程
5. **日常任务**（daily-task）：编排多代理执行 → 成本归因 → 阈值监控 → 报告生成

**预计代码量**：~1200 行 + ~80 单元测试

### 3.2 G33-02 UnifiedDashboardEngine

**目标**：实现统一 Dashboard 引擎，聚合 30+ 引擎关键指标。

**核心 API**：
- 指标采集：collectMetrics / getMetric / listMetrics
- 面板管理：createPanel / updatePanel / deletePanel / listPanels
- 实时推送：subscribe / unsubscribe / broadcast
- 报告导出：exportDashboard / exportReport

**12+ 预置面板**：
1. **系统健康度**：各引擎状态 + 错误率
2. **成本总览**：今日/本周/本月成本 + 趋势
3. **任务队列**：活跃任务 + 等待任务 + 完成率
4. **审计事件流**：实时事件流
5. **告警中心**：未处理告警 + 历史告警
6. **用户活跃度**：DAU/WAU/MAU + 趋势
7. **模型使用分布**：各模型占比 + 成本
8. **Worktree 状态**：活跃 worktree + 同步状态
9. **安全事件**：暴力破解/越权/数据外泄
10. **合规状态**：SOC 2/GDPR/ISO 27001 指标
11. **Skill 使用**：技能调用统计
12. **会话回放**：活跃会话 + 历史

**预计代码量**：~1000 行 + ~80 单元测试

### 3.3 G33-03 SecurityAuditEngine

**目标**：实现安全审计场景引擎，自动执行 + 验证 + 报告。

**核心 API**：
- 场景管理：registerScenario / listScenarios / getScenario
- 执行控制：execute / pause / resume / cancel / getStatus
- 报告生成：generateReport / exportReport
- CI/CD 集成：runInCI / validateBeforeDeploy

**7 个预置攻击场景**：
1. **暴力破解登录**：1000 次错误密码 → 预期 SSO 锁定
2. **越权访问**：普通用户 → admin API → 预期策略拒绝
3. **数据外泄**：批量下载敏感文件 → 预期策略限速
4. **会话劫持**：异常 IP 访问 → 预期 SSO 二次验证
5. **权限提升**：普通用户 → admin 角色 → 预期策略拒绝
6. **恶意文件上传**：上传恶意代码 → 预期策略拦截
7. **审计日志篡改**：修改事件 → 预期 Hash 验证失败

**预计代码量**：~1000 行 + ~80 单元测试

---

## 四、P1 任务清单（可选）

### 4.1 G33-04 FaultInjectionEngine
- 故障注入框架：网络延迟、服务降级、数据损坏
- 应急演练：混沌工程支持

### 4.2 G33-05 DataExportEngine
- 跨系统数据导出：CSV/JSON/PDF/Parquet
- 自动化数据管道

### 4.3 G33-06 DemoRecorder
- 录制端到端 Demo
- 自动生成演示视频

---

## 五、风险评估

### 5.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 引擎接口不一致 | 集成困难 | 适配器层抽象 |
| 30+ 引擎同时运行 | 性能瓶颈 | 懒加载 + 缓存 |
| 工作流编排复杂 | 调试困难 | 完整日志 + 可视化 |
| 安全场景误报 | 影响体验 | 白名单 + 调阈值 |

### 5.2 业务风险

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 引擎升级破坏集成 | 工作流失败 | 版本化接口 |
| 用户使用门槛高 | 接受度低 | 预置模板 |
| 安全场景触发真实事件 | 系统不稳定 | 沙箱环境 |

---

## 六、实施顺序

### Phase 1 - 调研 + 差距分析 + SPEC ✅
- [x] CYCLE33_CODEX_TRAE_RESEARCH.md
- [x] CYCLE33_GAP_ANALYSIS.md
- [ ] CYCLE33_SPEC_G33_01_ENTERPRISE_WORKFLOW.md
- [ ] CYCLE33_SPEC_G33_02_DASHBOARD.md
- [ ] CYCLE33_SPEC_G33_03_SECURITY_AUDIT.md

### Phase 2 - 核心引擎开发
- G33-01 EnterpriseWorkflowEngine + 80 单元测试
- G33-02 UnifiedDashboardEngine + 80 单元测试
- G33-03 SecurityAuditEngine + 80 单元测试

### Phase 3 - UI 组件 + 集成
- 3 大 UI 面板
- E2E 集成测试

### Phase 4 - 主应用集成
- BrandHeader 菜单
- AppLayout 透传
- App.tsx 渲染

### Phase 5 - 测试 + 验收
- 全量测试 4400+ 通过
- TypeScript 0 错误
- 验收报告 + 代码修改日志

### Phase 6 - Git 提交 + Cycle 34 启动
- 6 个 Git 提交
- CYCLE34_STARTUP.md

---

## 七、验收标准

### 7.1 功能验收
- [ ] 5 个企业场景模板可独立运行
- [ ] Dashboard 展示 12+ 面板
- [ ] 7 个攻击场景自动验证
- [ ] 三引擎协同工作

### 7.2 质量验收
- [ ] 单元测试覆盖 ≥ 80%
- [ ] TypeScript 0 错误
- [ ] E2E 集成测试 100% 通过
- [ ] 总测试数 ≥ 4400

### 7.3 业务验收
- [ ] 端到端 Demo 可演示
- [ ] 安全场景可重放
- [ ] 文档完整
