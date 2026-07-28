# P2-2 Hermes Doctor - 任务清单

> **任务 ID**: P2-2
> **关联规格**: [spec.md](./spec.md)
> **日期**: 2026-07-28
> **状态**: 📋 待执行

---

## 一、任务分解

### Phase A: 后端核心实现（10h）

- [ ] **A1**: 创建 `backend/app/core/doctor/` 目录结构
- [ ] **A2**: 实现 `base.py`（基类 + 数据模型 + 工具函数）
  - [ ] `CheckItem` 数据类
  - [ ] `CategoryReport` 数据类
  - [ ] `DoctorReport` 数据类
  - [ ] `FixSuggestion` 数据类
  - [ ] `BaseChecker` 抽象基类
  - [ ] 路径白名单 + 敏感信息脱敏
- [ ] **A3**: 实现 `checkers/environment.py`（10 项检查）
  - [ ] python_version
  - [ ] node_version
  - [ ] git_version
  - [ ] os / shell / encoding
  - [ ] anthropic_api_key / anthropic_base_url
  - [ ] home_dir / hermes_home
- [ ] **A4**: 实现 `checkers/workspace.py`（8 项检查）
  - [ ] current_path / git_status / remote
  - [ ] trae_dir / agents_md / specs_dir
  - [ ] disk_space / file_count
- [ ] **A5**: 实现 `checkers/llm.py`（6 项检查）
  - [ ] api_reachable / api_latency
  - [ ] models_available / token_quota
  - [ ] streaming / tool_use
- [ ] **A6**: 实现 `checkers/database.py`（6 项检查）
  - [ ] connection / migration / tables
  - [ ] indexes / size / wal_mode
- [ ] **A7**: 实现 `checkers/mcp.py`（6 项检查）
  - [ ] config_exists / config_valid
  - [ ] servers_declared / servers_reachable
  - [ ] protocol_version / tools_listed
- [ ] **A8**: 实现 `checkers/dependencies.py`（7 项检查）
  - [ ] fastapi / sqlalchemy / httpx / pydantic
  - [ ] uvicorn / frontend_node_modules / dist_exists
- [ ] **A9**: 实现 `runner.py`（DoctorRunner 主调度）
  - [ ] 并行执行 6 类检查
  - [ ] 聚合分类报告
  - [ ] 构建总报告
- [ ] **A10**: 实现 `formatters.py`（4 种输出）
  - [ ] SummaryFormatter
  - [ ] JSONFormatter
  - [ ] FullFormatter
  - [ ] PlainFormatter
- [ ] **A11**: 实现 `fix_advisor.py`（修复建议生成器）
  - [ ] 覆盖所有 error / warning 项
  - [ ] 风险评级（low / medium / high）
- [ ] **A12**: 实现 `history.py`（历史报告存储）
  - [ ] JSONL 持久化
  - [ ] 内存索引
  - [ ] 保留最近 50 份
  - [ ] 自动清理旧报告

### Phase B: REST API + CLI（2.5h）

- [ ] **B1**: 实现 `backend/app/api/doctor.py`（8 个端点）
  - [ ] `GET  /health`
  - [ ] `GET  /run`
  - [ ] `GET  /run?category={name}`
  - [ ] `GET  /{category}`
  - [ ] `POST /feedback`
  - [ ] `GET  /history`
  - [ ] `GET  /history/{id}`
  - [ ] `GET  /fix/{check_id}`
- [ ] **B2**: 注册路由到 `main.py`（v6.14.0 → v6.15.0）
- [ ] **B3**: 实现 `backend/app/cli/doctor_cli.py`
  - [ ] `hermes doctor` 默认命令
  - [ ] `--json` 选项
  - [ ] `--all` 选项
  - [ ] `--no-color` 选项
  - [ ] `--category` 选项

### Phase C: 前端实现（2h）

- [ ] **C1**: 实现 `frontend/src/hooks/useDoctorApi.ts`
  - [ ] 8 个 API 函数
  - [ ] TypeScript 类型定义
  - [ ] 辅助函数（状态颜色、图标）
- [ ] **C2**: 实现 `frontend/src/components/DoctorPanel.tsx`
  - [ ] 6 类卡片式布局
  - [ ] 顶部统计 + 过滤
  - [ ] 一键运行诊断
  - [ ] 单类展开详情
- [ ] **C3**: 实现 `frontend/src/components/DoctorCategoryCard.tsx`
  - [ ] 分类标题 + 图标
  - [ ] ok/warning/error 计数
  - [ ] 展开检查项列表
- [ ] **C4**: 实现 `frontend/src/components/DoctorFixSuggestion.tsx`
  - [ ] 步骤列表
  - [ ] 一键复制按钮
  - [ ] 风险等级徽章
- [ ] **C5**: 实现 `frontend/src/components/DoctorHistoryView.tsx`
  - [ ] 时间线列表
  - [ ] 历史对比（可选）
- [ ] **C6**: 实现 `frontend/src/pages/DoctorPage.tsx`
  - [ ] 独立路由 `/doctor`
- [ ] **C7**: 集成到主菜单 + 路由

### Phase D: 测试（2.5h）

- [ ] **D1**: 单元测试 `tests/test_doctor_units.py`（50+ 用例）
  - [ ] TestBaseChecker（5）
  - [ ] TestEnvironmentChecker（10）
  - [ ] TestWorkspaceChecker（8）
  - [ ] TestLLMChecker（6）
  - [ ] TestDatabaseChecker（6）
  - [ ] TestMCPChecker（6）
  - [ ] TestDependenciesChecker（7）
  - [ ] TestRunner（4）
  - [ ] TestFormatters（4）
  - [ ] TestFixAdvisor（5）
  - [ ] TestHistory（5）
- [ ] **D2**: E2E 测试 `tests/test_e2e_doctor.sh`（30+ 断言）
  - [ ] 模块 1: 健康检查
  - [ ] 模块 2: 完整诊断
  - [ ] 模块 3: 单类诊断
  - [ ] 模块 4: 修复建议
  - [ ] 模块 5: 历史报告
  - [ ] 模块 6: 反馈
  - [ ] 模块 7: 错误路径

### Phase E: 集成验证（1h）

- [ ] **E1**: TypeScript 编译 `tsc --noEmit` 0 错误
- [ ] **E2**: 前端构建 `npm run build` 成功
- [ ] **E3**: 后端服务重启，验证 `/api/doctor/health` 可用
- [ ] **E4**: 浏览器手动测试所有交互

### Phase F: 交付（1h）

- [ ] **F1**: 创建 `CYCLE11_P2_2_SUMMARY.md`
- [ ] **F2**: 更新 `代码修改日志.md`（v6.15.0）
- [ ] **F3**: Git 提交（v6.15.0）
- [ ] **F4**: 清理测试脚本和临时文件

---

## 二、关键里程碑

| 里程碑 | 时间 | 交付物 |
|---|---|---|
| M1: 后端核心 | T+10h | 6 个 checker + runner + formatters |
| M2: REST API | T+12.5h | 8 个端点可用 |
| M3: 前端 UI | T+14.5h | DoctorPanel 可用 |
| M4: 测试完成 | T+17h | 80+ 测试用例全过 |
| M5: 交付 | T+18h | Git 提交 + 总结 |

---

## 三、风险与缓解

| 风险 | 缓解 |
|---|---|
| LLM API 检查超时 | 5s 硬超时 + 降级为 warning |
| 6 类并行占用资源 | 限制 6 worker + 单类超时 |
| 历史报告膨胀 | 保留最近 50 份自动清理 |
| 修复建议命令误执行 | 默认不自动执行 + 风险评级 |

---

**下一步**: 创建 [checklist.md](./checklist.md) 验收清单
