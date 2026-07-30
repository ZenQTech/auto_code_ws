# Cycle 32 启动文档

**周期**：Cycle 32 (v6.89.0+)
**日期**：2026-07-30
**状态**：🟡 准备启动

---

## 一、Cycle 31 回顾

### 1.1 完成度

- ✅ 3 大 P0 任务（成本归因 / 远程 Worktree / Worktree 同步）
- ✅ 3 大引擎 + 3 UI 面板 + 21 E2E 测试
- ✅ TypeScript 严格模式 0 错误
- ✅ 测试 3860/3860 通过（100%）

### 1.2 关键交付

| 任务 | 版本 | 状态 |
|------|------|------|
| G31-01 Cost Attribution | v6.86.0 | ✅ |
| G31-02 Remote Worktree | v6.87.0 | ✅ |
| G31-03 Worktree Sync | v6.88.0 | ✅ |

### 1.3 Git 历史

```
9afea71 docs(cycle-31): 验收报告 + 代码修改日志
eb258f4 feat(cycle-31): 集成 3 大新功能到主应用 + 顶部菜单入口
753208e feat(cycle-31): 3 大 UI 面板 + E2E 集成测试
27bbe8f feat(cycle-31): 3 大核心引擎 + 单元测试
f1da6bb docs(cycle-31): 调研 + 差距分析 + 3 份 SPEC
```

---

## 二、Cycle 32 调研方向

### 2.1 主推方向 (A 方向) - **企业级安全 + 合规**

基于 Cycle 30/31 完成的企业级特性（成本治理、团队归因、远程 Worktree），
Cycle 32 重点补齐企业级安全 + 合规能力：

1. **G32-01 Audit Trail (审计追踪)**
   - 完整操作日志：所有 API 调用、配置变更、数据访问
   - 合规报告：SOC 2 / ISO 27001 / GDPR
   - 不可篡改：append-only + 哈希链
   - 长期保留：可配置保留期（默认 7 年）

2. **G32-02 SSO/OIDC Integration (单点登录)**
   - 标准 OIDC + OAuth 2.0 流程
   - SAML 2.0 支持
   - 多 IdP：Okta / Auth0 / Azure AD / Google Workspace
   - SCIM 自动用户配置

3. **G32-03 Policy Engine (策略规则引擎)**
   - 灵活的策略规则定义 (JSON DSL / Rego)
   - 多维度强制：org/team/project/user
   - 审计联动：策略触发自动记录

### 2.2 备选方向 (B 方向) - **多区域容灾 + SLA**

如果用户希望先做基础设施：

1. **G32-01 Multi-Region Failover (跨区域故障转移)**
   - 主备切换 + 自动健康检查
   - 数据复制 + 一致性保证

2. **G32-02 SLA Monitor (服务等级协议监控)**
   - 可用性 / 延迟 / 错误率
   - SLO 违约告警

3. **G32-03 Backup/Restore (数据备份与恢复)**
   - 自动备份 + 加密
   - PIT (Point-in-Time) 恢复

---

## 三、任务规划

### 3.1 Cycle 32 P0 任务（推荐）

- **G32-01 Audit Trail** - 完整审计日志与合规追踪
- **G32-02 SSO/OIDC** - 企业级单点登录
- **G32-03 Policy Engine** - 灵活策略规则引擎

### 3.2 P1 任务（备选）

- Audit Log UI
- OIDC Configuration UI
- Policy Visual Editor

### 3.3 待优化（继承自 Cycle 31）

- CostAttribution 实时 Dashboard 图表
- RemoteWorktree 真实云端集成
- WorktreeSync CRDT 冲突解决策略

---

## 四、重启机制

### 4.1 调研阶段

- 互联网调研：分析企业级安全趋势（Auth0、Okta、AWS IAM、Vault）
- 差距分析：识别 Hermes 现有安全相关功能空白
- SPEC 编写：3 份详细 SPEC 文档

### 4.2 开发阶段

- 核心引擎：Audit Trail / SSO / Policy Engine
- UI 组件：3 大新面板
- E2E 测试：完整端到端验证

### 4.3 验收阶段

- 测试报告：100% 通过
- 验收报告：完整文档
- Git 提交：5 个 commit 全部成功

---

## 五、风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| SSO 集成复杂度高 | 中 | 使用开源 OIDC 库 |
| 审计日志存储成本 | 中 | 配置化保留期 |
| 策略引擎性能 | 中 | 缓存 + 索引 |
| 合规标准多变 | 中 | 可配置规则 |

---

## 六、节奏

- 保持 Cycle 30/31 的 3 P0 任务节奏
- 每个引擎配套 30+ 单元测试
- 3 UI 组件 + 20+ E2E 测试
- 主应用集成 + 验收报告

---

**Cycle 32 准备状态**：✅ 调研方向明确，任务规划完成，等待用户确认主推方向。
