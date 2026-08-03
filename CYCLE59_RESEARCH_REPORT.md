# CYCLE 59 调研报告 - TRAE-browseruse 端到端测试方法论

> **日期**: 2026-08-03
> **调研方向**: B. TRAE-browseruse 端到端测试
> **目标**: 对 Cycle 58 交付的 5 大 P0 能力进行端到端验证

---

## 一、调研背景

Cycle 58 完成了 5 大 P0 任务（VibeCoding 入口 / ClaudeCodeShell 进程化 / LoopStateMachine 显式状态机 / Auto-Follow 联动 / ComposerPlan 真正可执行），但缺乏端到端的真实用户场景验证。

TRAE-browseruse 提供了真实浏览器自动化能力，可在用户验收前进行端到端测试，覆盖 UI 渲染、用户交互、数据流、状态迁移等完整链路。

---

## 二、端到端测试工具对比

### 主要工具

| 工具 | 优势 | 劣势 | 适用场景 |
|------|------|------|----------|
| **Playwright** | 多浏览器、原生并行、CI 友好、API 强大 | 学习曲线稍高 | 跨浏览器、大规模测试 |
| **Cypress** | 时间旅行调试、易上手、DX 优秀 | 浏览器支持有限 | 单浏览器、前端调试 |
| **Selenium** | 跨语言、生态成熟 | 速度慢、配置复杂 | 跨平台、多语言 |
| **TRAE-browseruse** | LLM 智能驱动、自然语言场景 | 依赖 LLM 推理 | AI 驱动的端到端测试 |

### 关键指标对比（2026 Q1）

| 指标 | Playwright | Cypress | TRAE-browseruse |
|------|-----------|---------|-----------------|
| 浏览器支持 | 3 引擎原生 | Chrome/Firefox | 依赖底层引擎 |
| 并行执行 | 内置免费 | 需 Cypress Cloud | LLM 调度 |
| 平均 flake 率 | 0.72% | 0.83% | 取决于场景 |
| 学习曲线 | 中等 | 简单 | 低（自然语言） |
| 真实场景验证 | 部分 | 部分 | 强（LLM 驱动） |

### 选型结论

**Cycle 59 采用 TRAE-browseruse**，原因：
1. **真实用户场景**: LLM 驱动可模拟用户自然语言描述的场景
2. **复杂交互验证**: 可验证 Vibe Coding、Auto-Follow 等复杂交互流
3. **错误诊断能力**: LLM 可智能诊断问题根因
4. **持续集成友好**: 与现有 loop engineering workflow 兼容

---

## 三、TRAE-browseruse 核心能力

### 1. 浏览器自动化基础
- 真实打开 Chromium/Firefox/WebKit
- 截图、视频录制
- 多标签页、多上下文
- 跨域访问

### 2. 自然语言场景描述
- 接受"用户输入"自然语言
- LLM 推理 → 操作序列
- 失败智能重试

### 3. 端到端验证维度
- **UI 渲染**: 截图比对、元素存在性
- **用户交互**: 点击、输入、滚动、拖拽
- **数据流**: SSE 订阅、状态迁移
- **性能**: 加载时间、响应延迟
- **错误恢复**: 异常场景、超时、重试

---

## 四、5 大 E2E 测试场景设计

### G59-01: VibeCoding 流程 E2E
**场景**: 用户从首页进入 Vibe Coding 模式，提交需求，跟踪状态机迁移
- 启动: 打开首页 → 看到 3 模式卡片
- 路由: 点击 vibe-coding → 跳转到 /vibe-coding
- 输入: 在 prompt 输入框填写需求
- 启动: 点击开始 → 看到状态从 idle → clarifying
- 迁移: 逐步验证 planning → executing → reviewing → done
- 截图: 每阶段截图
- 断言: LoopStatusBar 显示当前阶段

### G59-02: ComposerPlan 执行 E2E
**场景**: 用户创建 Plan，启动，监控步骤执行
- 创建: 通过 UI 创建多 step Plan
- 依赖: 验证 step 依赖图正确（a→b→c）
- 启动: 点击启动 → 看到 step 按依赖顺序执行
- 暂停: 暂停 → step 状态变为 paused
- 恢复: 恢复 → step 继续
- 取消: 取消 → step 状态变为 cancelled
- 重试: 失败的 step 可重试
- 截图: 每个控制动作后截图

### G59-03: LoopStateMachine 状态迁移 E2E
**场景**: 验证 LoopStateMachine 状态机的前端真实显示
- 启动: 打开 LoopStatusBar
- 触发: 通过 API 触发状态迁移
- 显示: LoopStatusBar 实时更新 stage
- 历史: 验证历史记录回放
- 进度: 验证 progress 进度条
- ETA: 验证 eta 显示
- 错误: 强制迁移到 error 状态

### G59-04: ClaudeCodeShell 真实调用 E2E
**场景**: 用户在前端输入命令，验证 CLI 真实调用
- 启动: 打开 Claude Shell 面板
- 输入: 输入简单命令（如 `echo hello`）
- 执行: 看到流式输出
- 超时: 输入耗时命令，验证超时熔断
- 降级: 模拟 CLI 不在 PATH，验证降级
- 安全: 输入包含特殊字符，验证路径净化

### G59-05: Auto-Follow 联动 E2E
**场景**: 验证 stage 变化自动切换面板
- 启动: 打开 Auto-Follow 开关
- 触发: 通过 API 触发 stage 变化
- 切换: 验证面板自动切换
- 配置: 修改 mapping 验证生效
- 黑名单: 配置黑名单验证过滤
- 历史: 查看触发历史

---

## 五、测试覆盖率目标

| 维度 | 目标 | 验证方式 |
|------|------|----------|
| 5 大 P0 任务 | 100% E2E 覆盖 | 5 个测试套件 |
| UI 渲染 | 100% 关键组件 | 截图比对 |
| 状态机迁移 | 100% 阶段覆盖 | 9 阶段遍历 |
| 错误恢复 | 100% 异常路径 | 故障注入 |
| 性能 | < 3s 加载 | 性能指标 |

---

## 六、参考资料

### 端到端测试方法论
- [React Testing Strategy 2026 - softaims.com](https://softaims.com/blog/react-testing-strategy-vitest-playwright-2026)
- [End-to-End Testing React with Cypress - oneuptime.com](https://oneuptime.com/blog/post/2026-01-15-e2e-testing-react-cypress/view)
- [Modern Frontend Testing Pyramid - feature-sliced.design](https://feature-sliced.design/vi/blog/frontend-testing-strategy)
- [Vitest + Testing Library 実践ガイド - techboostblog.com](https://techboostblog.com/blog/vitest-testing-guide/)

### Playwright vs Cypress
- [Playwright vs Cypress - testdino.com](https://testdino.com/blog/playwright-vs-cypress)
- [Cypress vs Playwright Key Differences - lambdatest.com](https://www.lambdatest.com/blog/cypress-vs-playwright/)
- [Playwright vs Cypress Guide - browserstack.com](https://www.browserstack.com/guide/playwright-vs-cypress)
- [Migrating Playwright to Cypress - cypress.io](https://docs.cypress.io/app/guides/migration/playwright-to-cypress)

### 浏览器自动化框架对比
- [浏览器自动化框架对比 - csdn.net](https://blog.csdn.net/weixin_49364648/article/details/143694104)
- [前端测试全方位指南 - csdn.net](https://blog.csdn.net/sinat_33255495/article/details/162423572)

---

## 七、调研结论

1. **TRAE-browseruse 是 Cycle 59 最佳选择**: 真实用户场景 + LLM 驱动 + 智能诊断
2. **5 大 P0 任务需全链路 E2E**: VibeCoding / ComposerPlan / LoopStateMachine / ClaudeCodeShell / Auto-Follow
3. **100% 阶段覆盖 + 100% 错误路径**: 9 阶段遍历 + 故障注入
4. **验收标准**: 截图比对 + 性能指标 + 错误恢复验证
