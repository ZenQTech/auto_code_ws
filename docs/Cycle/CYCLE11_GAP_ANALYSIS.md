# Cycle 11 差距分析 - Hermes v6.11.0 vs Codex v0.145.0 / TRAE v3.5.79

> **周期**: Cycle 11
> **分析时间**: 2026-07-28
> **对比基准**: Hermes v6.11.0 vs Codex v0.145.0 / TRAE v3.5.79
> **关联**: [CYCLE11_RESEARCH_REPORT.md](CYCLE11_RESEARCH_REPORT.md)

---

## 一、当前 Hermes 能力矩阵（v6.11.0）

| 功能领域 | 当前状态 | 已有版本 | 关联任务 |
|---|---|---|---|
| Loop Engineering v7 | ✅ 完整 | v1.0.0 | Cycle 8 P1-4 |
| Verification Loop（4 维度） | ✅ 完整 | v1.0.0 | Cycle 10 P1-10 |
| Memory System（Dual-Track） | ✅ 完整 | v1.0.0 | Cycle 10 P1-8 |
| Slash Commands | ✅ 12+ 内置 | v1.0.0 | Cycle 8 P0-12 |
| Custom Skills/Commands | ✅ 已实现 | v1.0.0 | Cycle 8 P0-13 |
| Custom Models + Bearer Token | ✅ 已实现 | v1.0.0 | Cycle 8 P0-14 |
| Multi-Agent v2 | ✅ Path Tree | v5.12.0 | Cycle 7 P0-10 |
| TRACE 规则管理 | ✅ 已实现 | v5.13.0 | Cycle 7 P0-11 |
| OAuth 2.1 + PKCE | ✅ 已实现 | v1.0.0 | Cycle 7 P0-8 |
| Session Rollout JSONL | ✅ 已实现 | v1.0.0 | Cycle 7 P0-9 |
| React Router SPA | ✅ 已实现 | v1.2.0 | Cycle 7 P1-2 |
| .trae/agents/ 子智能体 | ✅ 完整 | v1.0.0 | Cycle 9 P0-17 |
| .trae/hooks/ 事件增强 | ✅ 完整 | v1.0.0 | Cycle 9 P0-18 |
| .trae/rules/ 多级嵌套 | ✅ 完整 | v1.0.0 | Cycle 9 P1-6 |
| SKILL.md Progressive Disclosure | ✅ 完整 | v1.0.0 | Cycle 9 P1-5 |
| DiffView 增强 | ✅ 后端+UI 完整 | v2.0.0 | Cycle 9 P1-7 |
| **/import 跨平台迁移** | ❌ 完全缺失 | - | **Cycle 11 P3-1** |
| **doctor 环境诊断** | ⚠️ 仅 /health 端点 | - | **Cycle 11 P2-2** |
| **Playwright E2E 自动化** | ❌ 完全缺失 | - | **Cycle 11 P2-1** |

---

## 二、关键差距量化分析

### 2.1 P3-1 /import 跨平台配置迁移 ⭐⭐⭐⭐⭐ 最高优先级

**Codex v0.145.0 已实现**（2026-07-21）：
- `externalAgentConfig/detect` + `externalAgentConfig/import` JSON-RPC API
- 支持 4 类数据源：Cursor / Claude Code / Continue / 其他
- 迁移 6 类数据：settings / MCP servers / plugins / sessions / commands / project memories
- 异步后台 session 执行
- dry-run 预览模式

**当前 Hermes 状态**：❌ **完全缺失**

**差距影响**：
- 用户从其他 AI 编程工具切换到 Hermes **必须手动重新配置**所有 MCP 服务器、slash commands、项目 memory
- 切换成本高（用户研究显示**一个下午的重配置工作量**）
- 难以吸引已有 Claude Code / Cursor 习惯的用户

**具体缺失功能**：
1. 外部工具检测 API（扫描 `~/.claude/`、`~/.cursor/`、`~/.codex/`、`~/.trae/`）
2. 数据预览 API（dry-run，列出待迁移项）
3. 异步执行 API（导入任务 + 进度回调）
4. 状态查询 API（任务 ID → 状态）
5. 4 源平台格式转换器（JSON / TOML / YAML）
6. 6 类数据迁移器（settings/MCP/plugins/sessions/commands/memories）
7. 前端 `ImportPanel` 组件（可视化向导）
8. CLI 命令 `hermes import detect|preview|run`

**优先级**：⭐⭐⭐⭐⭐ 最高（直接影响用户增长 + 切换体验）

---

### 2.2 P2-2 doctor 环境诊断 ⭐⭐⭐⭐ 高优先级

**Codex v0.131.0+ 已实现**（2026-05-12）：
- 单命令 `codex doctor` 完整环境诊断
- 5 大类别：Environment / Configuration / Updates / Connectivity / Background Server
- 顶部 Notes 块聚合异常信号
- 4 种输出模式：--summary / --json / --all / --no-color
- JSON 输出脱敏后供支持工具消费
- 自动附加到 feedback 报告

**当前 Hermes 状态**：⚠️ **部分缺失**（仅 /health 端点）

**已有能力**：
- `GET /api/health` - DB + LLM API 健康检查（v5.9.0 Module B）
- 简易探活，不分类、不分级、无 Notes 聚合

**差距影响**：
- 用户遇到问题时**无法自助排查**，必须查看日志 / 提工单
- 客服支持效率低，需反复询问环境信息
- 与 P1-10 Verification Loop 缺少"环境就绪"前置检查

**具体缺失功能**：
1. 6 大类诊断：
   - **Environment**：Node.js / Python / Git / Docker 版本
   - **Workspace**：git status / remote / disk space
   - **LLM API**：base_url / model / 延迟
   - **Database**：SQLite integrity / connection pool
   - **MCP Servers**：连接状态 / 工具清单
   - **Dependencies**：Python packages / npm modules
2. Notes 块聚合（更新可用 / 磁盘满 / 混合认证 / MCP 异常）
3. 4 种输出模式（--summary / --json / --all / --no-color）
4. 自动修复建议（一键修复 button）
5. 反馈报告集成（自动附加到 /api/support/report）
6. 前端 `DoctorPanel` 组件（6 大类卡片 + 状态徽章 + 修复建议）
7. CLI 命令 `hermes doctor`

**优先级**：⭐⭐⭐⭐ 高（用户自助排查核心能力）

---

### 2.3 P2-1 Playwright E2E 自动化 ⭐⭐⭐ 中优先级

**最佳实践**（2026 主流）：
- Playwright CLI（`npx playwright test`）做 CI 回归
- Playwright MCP（`@playwright/mcp`）做 agent 驱动
- accessibility tree based selectors（getByRole / getByTestId）
- GitHub Actions + 截图对比 + 自动重试 + JUnit XML 报告

**当前 Hermes 状态**：❌ **完全缺失**

**已有能力**：
- 50+ 后端 E2E 测试脚本（curl + bash）
- 76+ 单元测试（pytest）

**差距影响**：
- 前端 UI 变更**无自动化验证**（DiffView、Memory、Loop、Verification 面板）
- 跨设备 / 跨浏览器一致性无保障
- UI 回归 bug 需手动发现

**具体缺失功能**：
1. Playwright 集成（package.json + playwright.config.ts）
2. 8 大核心场景测试：
   - 模式选择器（Chat/Solo/Code）
   - 聊天流式响应
   - DiffView 4 种格式切换
   - 快照管理（创建/恢复/删除）
   - Memory 编辑（创建实体 + observation）
   - Loop 命令（triage/plan/execute/verify）
   - Verification（创建任务 + 执行）
   - 文件浏览（项目树 + 预览）
3. GitHub Actions workflow（`.github/workflows/e2e.yml`）
4. JUnit XML 报告 + HTML 报告
5. 视觉回归 baseline 截图

**优先级**：⭐⭐⭐ 中（测试基础设施完善，不影响核心功能）

---

## 三、优先级与工时

| 任务 | 优先级 | 预估代码行数 | 单元测试 | E2E 测试 | 工时 |
|------|--------|--------------|----------|----------|------|
| P3-1 /import | ⭐⭐⭐⭐⭐ | 1500-2000 | 60+ | 40+ | 8-12h |
| P2-2 doctor | ⭐⭐⭐⭐ | 500-800 | 30+ | 20+ | 3-4h |
| P2-1 Playwright | ⭐⭐⭐ | 800-1200 | N/A（测试） | 30+ | 8-10h |
| **总计** | - | **2800-4000** | **90+** | **90+** | **19-26h** |

---

## 四、依赖关系

```
P3-1 /import ──→ 独立
                  └→ 可与 P2-2 doctor 集成（"诊断时检查导入状态"）

P2-2 doctor  ──→ 独立
                  └→ 后续 P1-10 Verification 可添加"doctor 通过"前置条件

P2-1 Playwright ──→ 独立
                   └→ 验证 P3-1 / P2-2 前端 UI
```

**推荐执行顺序**：
1. P3-1 /import（最高优先级，核心）
2. P2-2 doctor（高优先级，依赖少）
3. P2-1 Playwright（中优先级，验证前两者）

---

## 五、验收标准

### 5.1 P3-1 /import
- [ ] 4 源平台检测（Cursor/Claude Code/Codex/TRAE）
- [ ] 6 类数据迁移（settings/MCP/plugins/sessions/commands/memories）
- [ ] dry-run 预览模式
- [ ] 异步后台执行
- [ ] 进度回调 + 状态查询
- [ ] 失败回滚
- [ ] 单元测试 60+ 用例（100% 通过）
- [ ] E2E 测试 40+ 断言（100% 通过）
- [ ] 前端 `ImportPanel` 组件（向导式）
- [ ] CLI 命令 `hermes import`

### 5.2 P2-2 doctor
- [ ] 6 大类诊断完整（Environment/Workspace/LLM/Database/MCP/Dependencies）
- [ ] Notes 块聚合
- [ ] 4 种输出模式（--summary/--json/--all/--no-color）
- [ ] 自动修复建议
- [ ] 反馈报告集成
- [ ] 单元测试 30+ 用例（100% 通过）
- [ ] E2E 测试 20+ 断言（100% 通过）
- [ ] 前端 `DoctorPanel` 组件（6 大类卡片）

### 5.3 P2-1 Playwright
- [ ] 8 大核心场景覆盖
- [ ] GitHub Actions workflow
- [ ] JUnit XML + HTML 报告
- [ ] 视觉回归 baseline
- [ ] 30+ 测试用例（100% 通过）
- [ ] 跨浏览器（Chromium 主，Firefox/WebKit 可选）

---

## 六、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 4 源平台格式差异 | 解析失败 | 严格 try/except + 降级（未知字段保留原值） |
| 大量 MCP 配置迁移耗时 | 用户等待 | 异步 + 进度回调 + 估算完成时间 |
| doctor 误报 | 用户困扰 | 严格分级（✓/⚠/✗）+ Notes 解释 |
| Playwright CI 启动慢 | 测试慢 | 浏览器缓存 + worker 并行 + 重试 |
| 浏览器版本差异 | 跨平台不一致 | 固定 Chromium 版本（playwright.config.ts） |

---

## 七、产出物

- CYCLE11_RESEARCH_REPORT.md（已创建）
- CYCLE11_GAP_ANALYSIS.md（本文档）
- .trae/specs/cycle11/import/{spec.md,task.md,checklist.md}
- .trae/specs/cycle11/doctor/{spec.md,task.md,checklist.md}
- .trae/specs/cycle11/playwright/{spec.md,task.md,checklist.md}
- backend/app/services/import_service.py
- backend/app/services/doctor_service.py
- backend/app/api/import.py
- backend/app/api/doctor.py
- frontend/src/components/ImportPanel.tsx
- frontend/src/components/DoctorPanel.tsx
- frontend/src/pages/ImportPage.tsx
- frontend/src/pages/DoctorPage.tsx
- tests/test_import_units.py
- tests/test_doctor_units.py
- tests/test_e2e_import.sh
- tests/test_e2e_doctor.sh
- playwright.config.ts
- e2e/ 目录（8 大场景 spec 文件）
- .github/workflows/e2e.yml
- CYCLE11_P3_1_SUMMARY.md
- CYCLE11_P2_2_SUMMARY.md
- CYCLE11_P2_1_SUMMARY.md
- CYCLE11_SUMMARY.md
- 代码修改日志.md（更新到 v6.12.0+）

---

## 八、下一步

按优先级执行：
1. 创建 P3-1 /import 详细 spec
2. 实现 P3-1 /import + 测试 + 文档
3. 创建 P2-2 doctor 详细 spec
4. 实现 P2-2 doctor + 测试 + 文档
5. 创建 P2-1 Playwright 详细 spec
6. 实现 P2-1 Playwright + 测试 + 文档
7. Phase 7 端到端验证
8. 更新代码修改日志
9. Git 提交

