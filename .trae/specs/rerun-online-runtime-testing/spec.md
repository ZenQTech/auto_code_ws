# 重新全量在线运行时测试 Spec

> **来源**: 用户需求 — 在 `fix-claude-not-found` spec 修复 Bug 3 后，重新启动项目并在线测试所有功能，给出可视化证据
> **优先级**: P0
> **范围**: 全项目（FastAPI 后端 + React 前端 + 数据库 + CLI/Hermes 集成层）
> **与上一轮测试关系**: 复用 `online-runtime-testing` 的方法论；针对修复后的当前状态重新取证

## Why

上一轮 [`online-runtime-testing`](file:///home/qizheng/auto_code_ws/.trae/specs/online-runtime-testing/spec.md) 真实捕获 3 个严重 Bug（已记入 [RUNTIME_TEST_REPORT.md](file:///home/qizheng/auto_code_ws/data/runtime_test_evidence/RUNTIME_TEST_REPORT.md) §四）：
- **Bug 1**：`/health` 被 StaticFiles 拦截返回 404
- **Bug 2**：`datetime.UTC` 在 Python 3.10 不可用（5+ 端点 500）
- **Bug 3**：`claude` 命令找不到（nvm 安装但 uvicorn PATH 不含）

`fix-claude-not-found` spec 已修复 Bug 3。本 spec 目标：
1. 验证 Bug 3 修复是否真的生效（证据：claude 实际执行 ≥1 次）
2. 重新对全部 22 个 API 端点在线取证，与上一轮结果对比
3. 重新渲染前端，验证 UI 仍可正常显示
4. 诚实记录 Bug 1、Bug 2 的当前状态（未修复 → 应仍失败）
5. 产出一份"修复后"对比报告 `data/runtime_test_evidence/RUNTIME_TEST_REPORT_AFTER_FIX.md`

## What Changes

### 1. 重启后端服务
- **杀掉旧进程**（PID 1938512 来自 fix 测试）
- **重新启动** `python3 run.py`，日志落到 `data/runtime_test_evidence/backend_rerun.log`
- **验证** `curl http://localhost:8080/health` 状态（预期仍 404，对应 Bug 1）

### 2. 22 个 API 端点重新取证
对每个端点重新执行 curl 调用，**记录与上一轮的差异**：
- 与上一轮响应一致 → 标"无变化"
- 与上一轮不同 → 标"已变化"并附 diff
- 上一轮失败现在通过 → 标"已修复"
- 上一轮通过现在失败 → 标"新增故障"（需排查根因）

### 3. 前端重新渲染
- 用 Chrome headless 重新截首页
- 与上一轮 `04_home_with_js.png` 对比（应一致）

### 4. 产出"修复后"对比报告
- 文件：`data/runtime_test_evidence/RUNTIME_TEST_REPORT_AFTER_FIX.md`
- 内容：
  - 22 端点对比表（修复前 HTTP 状态 → 修复后 HTTP 状态）
  - Bug 1/2/3 闭环状态
  - 端点级 diff 详情
  - 所有证据文件索引

## Impact

- Affected specs: `online-runtime-testing`（对比基线）、`fix-claude-not-found`（验证修复）
- Affected code: **不修改任何业务代码**，仅取证
- 新增文件：
  - `data/runtime_test_evidence/api_responses_rerun/*.json`（重新取证的响应）
  - `data/runtime_test_evidence/screenshots_rerun/*.png`（重新截图）
  - `data/runtime_test_evidence/backend_rerun.log`（新后端日志）
  - `data/runtime_test_evidence/RUNTIME_TEST_REPORT_AFTER_FIX.md`（对比报告）
  - `data/runtime_test_evidence/scripts/rerun_test.sh`（一键重跑脚本）

## 约束

- 沿用 `online-runtime-testing` 的全部"硬约束"（必须真实启动、必须可视证据、失败如实记录、不能改业务代码）
- 每次取证必须附时间戳（精确到秒），便于跨次对比
- 与上一轮**完全相同**的端点必须有完全相同的 request payload（保证对比公平）
- 杀掉旧进程前必须确认是新一轮独立测试，避免污染

---

## ADDED Requirements

### Requirement: 后端真实重启

系统 SHALL 在本轮测试中真实重启后端服务，**复用上一轮进程的 PID 不算数**。

#### Scenario: 旧进程清理
- **WHEN** 检测到 8080 已有旧进程
- **THEN** 先 kill，再启动新进程
- **AND** 记录旧 PID 与新 PID 到 `backend_rerun.log`

#### Scenario: 健康检查
- **WHEN** 新进程启动
- **THEN** `curl http://localhost:8080/health` 返回 200 或 404（**预期 404 对应 Bug 1**）

### Requirement: 22 端点重测 + 对比

系统 SHALL 对 22 个 API 端点重新 curl 调用，并产出"修复前 vs 修复后"对比。

#### Scenario: 端点状态变化检测
- **WHEN** 重测某端点
- **THEN** 对比上一轮 `*.meta.json` 的 HTTP 状态码
- **AND** 在对比报告中标注：PASS→PASS / FAIL→PASS / PASS→FAIL / FAIL→FAIL

#### Scenario: Bug 3 修复验证
- **WHEN** 调用 `POST /api/hermes/optimize`
- **THEN** 响应中不含 `"claude: not found"` 字符串
- **AND** backend 日志含 `claude.exe 命令执行成功，耗时 Ns`（N > 0）

### Requirement: 前端重新渲染

系统 SHALL 用 Chrome headless 重新渲染首页。

#### Scenario: 截图差异
- **WHEN** 重新截 `01_home_rerun.png`
- **THEN** 与上一轮 `04_home_with_js.png` 像素级对比
- **AND** 允许的内容差异：时间戳、随机 UI 状态

### Requirement: 对比报告诚实

系统 SHALL 产出诚实对比报告，禁止隐瞒"修复后又坏"或"修复失败"的情况。

#### Scenario: 报告含完整 diff 表
- **WHEN** 报告生成
- **THEN** 22 端点 diff 表格 + 3 个 Bug 的"期望修复 vs 实际状态"两栏对比

## MODIFIED Requirements

无

## REMOVED Requirements

无
