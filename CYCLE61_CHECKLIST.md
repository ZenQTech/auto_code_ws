# CYCLE61_CHECKLIST.md — 验收清单

> **Cycle**: 61
> **日期**: 2026-08-04
> **关联文档**: CYCLE61_SPEC.md / CYCLE61_TASK.md

---

## 1. G61-01: Claude Code CLI 真实 subprocess

### 1.1 功能验收

- [ ] **T1.1** 启动 Claude CLI subprocess，验证进程创建
  - 测试命令：`curl -X POST /api/claude-cli/exec -d '{"prompt":"hello"}'`
  - 预期：返回 202 + subprocess 已创建
  - 验证：`ps aux | grep claude`

- [ ] **T1.2** stdin 发送 prompt，stdout 接收响应
  - 测试命令：发送 prompt "实现 Hello World"
  - 预期：stdout 接收到响应
  - 验证：读取 `/tmp/claude-cli-{id}/stdout.log`

- [ ] **T1.3** SSE 流式转发到前端，前端实时显示
  - 测试：浏览器调用 useClaudeCLI
  - 预期：响应逐 chunk 显示，无延迟
  - 验证：TRAE-browseruse 截图

- [ ] **T1.4** 思考过程单独通道（cli_thinking）
  - 测试：复杂任务
  - 预期：`cli_thinking` 事件单独触发
  - 验证：检查 SSE 事件流

- [ ] **T1.5** 工具调用展示（cli_tool_call）
  - 测试：触发 read_file 工具
  - 预期：`cli_tool_call` 事件携带工具名 + 参数
  - 验证：检查 SSE 事件流

- [ ] **T1.6** 取消按钮触发 `POST /cancel`，subprocess 被 kill
  - 测试：点击取消
  - 预期：subprocess 收到 SIGTERM，5s 内退出
  - 验证：`ps aux | grep claude` 应该无该进程

- [ ] **T1.7** 超时自动 kill
  - 测试：设置 timeout=10s，任务运行 > 10s
  - 预期：subprocess 自动 kill
  - 验证：检查 exit code

- [ ] **T1.8** `claude` 不在 PATH 时降级到 LLM HTTP
  - 测试：移除 `claude` 从 PATH
  - 预期：自动调用 LLM HTTP
  - 验证：检查日志有 "降级" 字样

### 1.2 性能验收

- [ ] **T1.9** 启动延迟 < 500ms（5 次平均）
  - 测试：连续启动 5 次
  - 预期：平均启动时间 < 500ms
  - 验证：使用 `time` 命令

- [ ] **T1.10** 流式输出延迟 < 100ms
  - 测试：发送 prompt，测量 chunk 间延迟
  - 预期：每 chunk 间 < 100ms
  - 验证：检查 SSE 时间戳

- [ ] **T1.11** 并发 5 个 CLI 进程，内存 < 2.5GB
  - 测试：并发 5 个 CLI
  - 预期：总内存 < 2.5GB
  - 验证：`ps aux | grep claude` RSS 之和

### 1.3 安全验收

- [ ] **T1.12** subprocess 无法访问工作目录外文件
  - 测试：在 sandbox 外创建 `/tmp/test-secret.txt`，尝试读取
  - 预期：subprocess 无法读取
  - 验证：检查错误信息

- [ ] **T1.13** subprocess 无法发起任意网络连接
  - 测试：在 sandbox 内执行 `curl example.com`
  - 预期：连接被拒绝
  - 验证：检查 exit code 非 0

- [ ] **T1.14** 资源超限自动 kill
  - 测试：触发 OOM（分配大内存）
  - 预期：subprocess 自动 kill
  - 验证：检查 exit code

- [ ] **T1.15** 异常退出时清理资源
  - 测试：手动 kill -9 subprocess
  - 预期：临时文件 / 端口被清理
  - 验证：`ls /tmp/claude-cli-*`

### 1.4 浏览器端到端验收（TRAE-browseruse）

- [ ] **T1.16** 打开 Solo 模式
  - 路径：`http://localhost:5173/solo`
  - 预期：Solo 模式主壳加载

- [ ] **T1.17** 输入 prompt
  - 操作：在 composer 中输入 "实现一个 Go 语言 Hello World"
  - 预期：文本框接受输入

- [ ] **T1.18** 点击启动，验证流式输出显示
  - 操作：点击启动按钮
  - 预期：流式输出逐 chunk 显示

- [ ] **T1.19** 验证思考过程单独显示
  - 操作：观察 thinking 区域
  - 预期：思考过程单独通道显示

- [ ] **T1.20** 验证工具调用卡片显示
  - 操作：触发工具调用
  - 预期：工具调用卡片显示

- [ ] **T1.21** 点击取消，验证进程被 kill
  - 操作：点击取消按钮
  - 预期：进程被 kill，UI 显示"已取消"

- [ ] **T1.22** 验证 `claude` 缺失时降级到 LLM HTTP 正常工作
  - 操作：移除 `claude` CLI
  - 预期：降级到 LLM HTTP 正常工作

### 1.5 单元测试验收

- [ ] **UT1.1** Backend 单元测试覆盖率 ≥ 80%
- [ ] **UT1.2** Frontend 单元测试覆盖率 ≥ 80%
- [ ] **UT1.3** 集成测试通过

**通过标准**: 25/25 项全通过

---

## 2. G61-02: Goal mode 完整循环 UI

### 2.1 功能验收

- [ ] **T2.1** 创建 Goal，验证自动分解为 Plan
  - 测试：POST /api/goal 创建 Goal
  - 预期：返回 Goal + Plan 自动生成
  - 验证：检查 plan.steps 长度

- [ ] **T2.2** Plan 分解为 Step
  - 测试：复杂 Goal（"开发 TODO 应用"）
  - 预期：分解为 5+ 步骤
  - 验证：检查 plan.steps

- [ ] **T2.3** 三层树状可视化（Goal-Plan-Step）
  - 测试：浏览器打开 Goal mode
  - 预期：三层树状展示
  - 验证：TRAE-browseruse 截图

- [ ] **T2.4** pause 后状态保存到 IndexedDB
  - 测试：点击 pause
  - 预期：状态保存到 IndexedDB
  - 验证：DevTools → Application → IndexedDB

- [ ] **T2.5** 刷新页面后自动恢复
  - 测试：刷新浏览器
  - 预期：Goal 状态自动恢复
  - 验证：TRAE-browseruse 刷新后截图

- [ ] **T2.6** resume 后继续执行
  - 测试：点击 resume
  - 预期：从暂停的 step 继续
  - 验证：检查 current_step

- [ ] **T2.7** 每 5 步自动生成进度报告
  - 测试：执行 5+ 步
  - 预期：进度报告自动生成
  - 验证：检查 progress 事件

- [ ] **T2.8** Step 失败时进入 error 状态，可重试
  - 测试：模拟 step 失败
  - 预期：step 进入 failed 状态
  - 验证：检查 step.state

### 2.2 性能验收

- [ ] **T2.9** Goal 创建到 Plan 生成 < 5s
  - 测试：创建复杂 Goal
  - 预期：Plan 生成时间 < 5s
  - 验证：使用 `time` 命令

- [ ] **T2.10** 100 节点三层树渲染 < 100ms
  - 测试：渲染 100 节点的 Goal
  - 预期：渲染时间 < 100ms
  - 验证：Chrome DevTools Performance

### 2.3 安全验收

- [ ] **T2.11** pause 操作需二次确认
  - 测试：点击 pause
  - 预期：弹出确认对话框
  - 验证：TRAE-browseruse 检查 modal

- [ ] **T2.12** Step owner 严格匹配
  - 测试：跨用户尝试操作
  - 预期：被拒绝
  - 验证：检查 HTTP 403

### 2.4 浏览器端到端验收（TRAE-browseruse）

- [ ] **T2.13** 打开 Goal mode UI
  - 路径：Solo 模式 → Goal mode
  - 预期：Goal mode UI 加载

- [ ] **T2.14** 创建 Goal "开发 TODO 应用"
  - 操作：填写表单提交
  - 预期：Goal 创建成功

- [ ] **T2.15** 验证自动生成 Plan + Step
  - 操作：观察 Goal tree
  - 预期：Plan + Step 自动展示

- [ ] **T2.16** 点击 Step 节点查看详情
  - 操作：点击某个 step
  - 预期：详情面板打开

- [ ] **T2.17** 点击 pause，验证状态保存
  - 操作：点击 pause
  - 预期：状态保存，UI 提示

- [ ] **T2.18** 刷新页面，验证状态恢复
  - 操作：刷新浏览器
  - 预期：状态自动恢复

- [ ] **T2.19** 点击 resume，验证继续执行
  - 操作：点击 resume
  - 预期：从暂停处继续

- [ ] **T2.20** 验证进度报告每 5 步自动生成
  - 操作：执行 5+ 步
  - 预期：进度报告显示

### 2.5 单元测试验收

- [ ] **UT2.1** Backend 单元测试覆盖率 ≥ 80%
- [ ] **UT2.2** Frontend 单元测试覆盖率 ≥ 80%
- [ ] **UT2.3** 集成测试通过

**通过标准**: 25/25 项全通过

---

## 3. G61-03: Auto-Follow 联动增强

### 3.1 功能验收

- [ ] **T3.1** 15 类事件完整监听
  - 测试：触发 15 类事件
  - 预期：每类事件都有响应
  - 验证：单元测试覆盖

- [ ] **T3.2** 47 panel 完整映射
  - 测试：每类事件触发对应 panel
  - 预期：47 panel 全部覆盖
  - 验证：单元测试覆盖

- [ ] **T3.3** Predictive Switch 正确预测下一个工具
  - 测试：模拟 AI 即将执行 read_file
  - 预期：editor 面板预先打开
  - 验证：TRAE-browseruse 截图

- [ ] **T3.4** Split View 上下分屏工作
  - 测试：启用 Split View
  - 预期：主面板 + 工具面板上下分屏
  - 验证：TRAE-browseruse 截图

- [ ] **T3.5** Sticky Tool 固定不被切换
  - 测试：固定 terminal 工具
  - 预期：terminal 不被自动切换
  - 验证：TRAE-browseruse 观察

- [ ] **T3.6** 100ms 节流生效
  - 测试：连续触发 10 次同类型事件
  - 预期：100ms 内只触发 1 次
  - 验证：单元测试

- [ ] **T3.7** 事件优先级排序正确
  - 测试：error + executing 同时触发
  - 预期：error 优先
  - 验证：单元测试

### 3.2 性能验收

- [ ] **T3.8** 事件 → panel 切换 < 50ms
  - 测试：测量切换时间
  - 预期：< 50ms
  - 验证：Chrome DevTools Performance

### 3.3 浏览器端到端验收（TRAE-browseruse）

- [ ] **T3.9** 启动 Vibe Coding，验证 step_started → planExecutor
  - 操作：启动 session
  - 预期：planExecutor 自动打开

- [ ] **T3.10** 验证 code_writing → editor
  - 操作：观察 code 写入
  - 预期：editor 自动打开

- [ ] **T3.11** 验证 test_running → terminal
  - 操作：观察 test 运行
  - 预期：terminal 自动打开

- [ ] **T3.12** 验证 step_failed → error
  - 操作：模拟失败
  - 预期：error 面板打开

- [ ] **T3.13** 启用 Split View，验证上下分屏
  - 操作：点击 Split View
  - 预期：上下分屏

- [ ] **T3.14** 固定 Sticky Tool，验证不被切换
  - 操作：固定 terminal
  - 预期：terminal 保持显示

### 3.4 单元测试验收

- [ ] **UT3.1** useAutoFollow v2.0.0 测试覆盖率 ≥ 80%
- [ ] **UT3.2** SplitView / StickyTool 测试覆盖率 ≥ 80%
- [ ] **UT3.3** 集成测试通过

**通过标准**: 18/18 项全通过

---

## 4. G61-04: ComposerPlan 真正可执行

### 4.1 功能验收

- [ ] **T4.1** Composer Plan 解析为 step 列表
  - 测试：解析 3 步 Plan
  - 预期：返回 3 个 step
  - 验证：检查 steps 数组

- [ ] **T4.2** 每步自动调用 LLM
  - 测试：执行 Plan
  - 预期：每步 LLM 调用
  - 验证：检查 LLM 调用日志

- [ ] **T4.3** pause/resume 完整状态恢复
  - 测试：执行 → pause → resume
  - 预期：状态完整恢复
  - 验证：检查 current_step

- [ ] **T4.4** 跳过 step
  - 测试：点击跳过
  - 预期：step 标记为 skipped
  - 验证：检查 step.state

- [ ] **T4.5** 重试 step
  - 测试：失败 step 重试
  - 预期：step 重新执行
  - 验证：检查 retry_count

- [ ] **T4.6** 失败时按策略处理
  - 测试：on_failure=skip / retry / abort
  - 预期：按策略处理
  - 验证：单元测试

- [ ] **T4.7** 步骤自动验证
  - 测试：auto_verify=true
  - 预期：执行后自动验证
  - 验证：检查 verification_result

- [ ] **T4.8** 死循环防护（max_steps）
  - 测试：模拟死循环 Plan（> 100 步）
  - 预期：自动终止
  - 验证：检查终止日志

### 4.2 性能验收

- [ ] **T4.9** Plan 解析 < 100ms
  - 测试：解析大型 Plan
  - 预期：< 100ms
  - 验证：`time` 命令

- [ ] **T4.10** 死循环防护生效
  - 测试：100+ 步 Plan
  - 预期：自动终止在 100 步
  - 验证：检查 execution state

### 4.3 浏览器端到端验收（TRAE-browseruse）

- [ ] **T4.11** 在 Composer 中创建 Plan（3 步）
  - 操作：添加 3 个 step
  - 预期：Plan 列表显示

- [ ] **T4.12** 点击执行，验证 step 依次执行
  - 操作：点击执行
  - 预期：3 步依次执行

- [ ] **T4.13** 点击 pause，验证状态保存
  - 操作：点击 pause
  - 预期：状态保存

- [ ] **T4.14** 点击 resume，验证继续
  - 操作：点击 resume
  - 预期：从暂停处继续

- [ ] **T4.15** 验证失败的 step 可重试
  - 操作：模拟失败
  - 预期：可点击重试

- [ ] **T4.16** 验证死循环防护
  - 操作：创建死循环 Plan
  - 预期：自动终止，UI 提示

### 4.4 单元测试验收

- [ ] **UT4.1** Plan Executor 单元测试覆盖率 ≥ 80%
- [ ] **UT4.2** useComposerPlan 单元测试覆盖率 ≥ 80%
- [ ] **UT4.3** 集成测试通过

**通过标准**: 19/19 项全通过

---

## 5. 通用验收

### 5.1 代码质量

- [ ] **QC1** TypeScript / Python 类型完整
- [ ] **QC2** 注释覆盖率 ≥ 80%
- [ ] **QC3** 单元测试覆盖率 ≥ 80%
- [ ] **QC4** ESLint / Prettier 通过
- [ ] **QC5** MyPy 通过

### 5.2 性能

- [ ] **PF1** 启动延迟 < 500ms
- [ ] **PF2** API 响应 < 200ms
- [ ] **PF3** 流式输出延迟 < 100ms
- [ ] **PF4** 内存 < 512MB / process

### 5.3 兼容性

- [ ] **CP1** Chrome 最新版正常
- [ ] **CP2** Edge 最新版正常
- [ ] **CP3** Firefox 最新版正常
- [ ] **CP4** Safari 最新版正常
- [ ] **CP5** 暗色 / 浅色 / 高对比度 3 主题正常
- [ ] **CP6** 桌面 / 平板 / 移动端 3 设备正常

### 5.4 安全性

- [ ] **SC1** Sandbox 隔离生效
- [ ] **SC2** Rate limiting 生效
- [ ] **SC3** 资源限制（CPU / MEM / TIME）生效
- [ ] **SC4** 输入验证生效
- [ ] **SC5** 错误兜底生效

### 5.5 集成验收

- [ ] **IN1** 4 个 P0 任务集成到 Solo 模式
- [ ] **IN2** 与现有 47 panel 无冲突
- [ ] **IN3** 与 Loop V7 引擎无缝衔接
- [ ] **IN4** 与 Hook 体系（10 类事件）兼容
- [ ] **IN5** Git worktree 集成正常

### 5.6 文档验收

- [ ] **DC1** CYCLE61_RESEARCH.md 完成
- [ ] **DC2** CYCLE61_GAP_ANALYSIS.md 完成
- [ ] **DC3** CYCLE61_SPEC.md 完成
- [ ] **DC4** CYCLE61_TASK.md 完成
- [ ] **DC5** CYCLE61_CHECKLIST.md 完成
- [ ] **DC6** CYCLE61_CODE_MODIFICATION_LOG.md 完成
- [ ] **DC7** CYCLE61_ACCEPTANCE_REPORT.md 完成

---

## 6. 总体通过标准

- **单元测试覆盖率**: ≥ 80%
- **集成测试通过率**: 100%
- **浏览器端到端测试通过率**: 100%
- **性能基线**: 启动 < 500ms, API < 200ms, 流式 < 100ms
- **兼容性**: 4 浏览器 × 3 主题 × 3 设备 = 36 组合全部通过
- **安全性**: 5 项安全检查全部通过
- **集成验收**: 5 项集成检查全部通过
- **文档验收**: 7 项文档验收全部完成

**总验收项**: 25 + 25 + 18 + 19 + 5 + 4 + 5 + 5 + 7 = 113 项

**通过标准**: 113/113 项全通过，0 个未通过项

---

**验收清单完成。Cycle 61 准备就绪，开始实施。**
