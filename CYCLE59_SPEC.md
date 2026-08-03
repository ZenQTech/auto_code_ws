# CYCLE59 SPEC - TRAE-browseruse 端到端测试 5 大 P0 任务

> **日期**: 2026-08-03
> **目标**: 用 TRAE-browseruse 真实执行端到端测试，验证 Cycle 58 交付的 5 大 P0 能力
> **覆盖范围**: VibeCoding / ComposerPlan / LoopStateMachine / ClaudeCodeShell / Auto-Follow

---

## G59-01: VibeCoding 流程端到端测试

### 功能需求
- **目标**: 验证 VibeCoding 完整流程在真实浏览器中可工作
- **用户场景**: 用户从首页进入 Vibe Coding 模式，提交需求，跟踪状态机迁移
- **使用流程**:
  1. 打开首页（http://localhost:5173/）
  2. 看到 3 模式卡片（chat/coding/vibe-coding）
  3. 点击 vibe-coding 卡片
  4. 跳转到 /vibe-coding 路由
  5. 进入 VibeCodingPage，看到 LoopStatusBar + 多 panel
  6. 在 prompt 输入框填写需求
  7. 点击开始按钮
  8. 状态从 idle → clarifying → planning → executing → done 全链路

### 技术实现
- **E2E 工具**: TRAE-browseruse
- **测试场景**: 完整用户旅程
- **断言方式**: 截图比对 + DOM 元素存在性 + 状态机迁移断言

### 接口与数据结构
- 前端路由: `/vibe-coding`
- API 端点: 
  - `POST /api/vibe-coding/session` (创建 session)
  - `POST /api/vibe-coding/session/{id}/pause`
  - `POST /api/vibe-coding/session/{id}/resume`
  - `POST /api/vibe-coding/session/{id}/cancel`
- 状态机: idle/clarifying/planning/executing/reviewing/done/paused/cancelled/error

### 验收标准
- [ ] 首页显示 3 模式卡片
- [ ] 点击 vibe-coding 成功跳转
- [ ] VibeCodingPage 正确渲染
- [ ] LoopStatusBar 显示当前阶段
- [ ] 状态机 9 阶段至少覆盖 5 阶段（idle/clarifying/planning/executing/done）
- [ ] 每阶段截图保存
- [ ] SSE 事件订阅成功
- [ ] 暂停/恢复/取消控件可用

---

## G59-02: ComposerPlan 执行端到端测试

### 功能需求
- **目标**: 验证 ComposerPlan 真实可执行
- **用户场景**: 用户通过 UI 创建 Plan，启动并监控步骤执行
- **使用流程**:
  1. 进入 /api/composer-plan UI 入口（或前端 PlanExecutorPanel）
  2. 创建 Plan（3-5 steps，带依赖关系）
  3. 点击启动按钮
  4. 看到 step 按依赖顺序执行（先 a，再 b/c 并行，最后 d）
  5. 暂停按钮可用
  6. 恢复按钮可用
  7. 取消按钮可用
  8. 失败的 step 可重试/跳过

### 技术实现
- **E2E 工具**: TRAE-browseruse
- **测试场景**: Plan 创建/启动/暂停/恢复/取消
- **断言方式**: step 状态断言 + 依赖顺序验证

### 接口与数据结构
- API 端点:
  - `POST /api/composer-plan` (创建)
  - `POST /api/composer-plan/{id}/start`
  - `POST /api/composer-plan/{id}/pause`
  - `POST /api/composer-plan/{id}/resume`
  - `POST /api/composer-plan/{id}/cancel`
  - `POST /api/composer-plan/{id}/step/{step_id}/retry`
  - `POST /api/composer-plan/{id}/step/{step_id}/skip`
- 数据结构: plan.status / step.status (7 状态机)

### 验收标准
- [ ] Plan 创建成功（HTTP 200）
- [ ] 启动后 step 状态从 pending → ready → running → completed
- [ ] 依赖图正确（b 等待 a 完成）
- [ ] 暂停后状态变为 paused
- [ ] 恢复后继续执行
- [ ] 取消后状态变为 cancelled
- [ ] 失败 step 可重试
- [ ] 失败 step 可跳过
- [ ] SSE 事件正确推送

---

## G59-03: LoopStateMachine 状态机迁移 E2E

### 功能需求
- **目标**: 验证 LoopStateMachine 显式状态机在前端真实显示
- **用户场景**: 验证 9 阶段状态机的真实可见性
- **使用流程**:
  1. 打开任意带 LoopStatusBar 的页面
  2. 触发 API 状态迁移
  3. 验证 LoopStatusBar 实时更新
  4. 验证 progress 进度条
  5. 验证 eta_seconds 显示
  6. 验证历史记录

### 技术实现
- **E2E 工具**: TRAE-browseruse
- **测试场景**: 9 阶段遍历
- **断言方式**: DOM 元素 + 数据属性

### 接口与数据结构
- API 端点:
  - `GET /api/loop-state/machine` (查询)
  - `POST /api/loop-state/transition` (迁移)
  - `GET /api/loop-state/machine/events` (SSE)
- 状态枚举: idle/clarifying/designing/prompting/executing/reviewing/done/paused/error/cancelled

### 验收标准
- [ ] 9 状态全部可触发
- [ ] 不允许的迁移被拒绝（force=False）
- [ ] 强制迁移工作（force=True）
- [ ] 进度 0-1 范围
- [ ] ETA 显示
- [ ] 历史保留最近 200 条
- [ ] SSE 事件正确推送

---

## G59-04: ClaudeCodeShell 进程化 E2E

### 功能需求
- **目标**: 验证 ClaudeCodeShell 真实 CLI 调用
- **用户场景**: 用户在前端输入命令，验证流式输出
- **使用流程**:
  1. 打开 Claude Shell 面板
  2. 输入命令（如 `echo "hello"`）
  3. 点击执行
  4. 看到流式输出
  5. 验证超时熔断
  6. 验证路径净化

### 技术实现
- **E2E 工具**: TRAE-browseruse
- **测试场景**: 真实 CLI 调用
- **断言方式**: 文本输出比对

### 接口与数据结构
- API 端点:
  - `POST /api/claude-shell/exec` (执行命令)
  - `GET /api/claude-shell/events/{id}` (SSE 流)
  - `GET /api/claude-shell/available` (探测 CLI)
- 数据结构: 进程 ID、stdout、stderr、exit_code

### 验收标准
- [ ] CLI 可用时真实调用
- [ ] CLI 不在 PATH 时降级
- [ ] 超时熔断（>60s 自动终止）
- [ ] 路径净化（特殊字符过滤）
- [ ] 流式输出到前端
- [ ] 错误码正确返回

---

## G59-05: Auto-Follow 联动 E2E

### 功能需求
- **目标**: 验证 Auto-Follow 联动真实工作
- **用户场景**: stage 变化自动切换前端面板
- **使用流程**:
  1. 打开 Auto-Follow 开关
  2. 触发 stage 变化（通过 API）
  3. 验证面板自动切换
  4. 配置自定义 mapping
  5. 配置黑名单
  6. 查看历史

### 技术实现
- **E2E 工具**: TRAE-browseruse
- **测试场景**: 联动 + 配置
- **断言方式**: 面板可见性

### 接口与数据结构
- API 端点:
  - `GET /api/auto-follow/config`
  - `POST /api/auto-follow/config`
  - `GET /api/auto-follow/mapping`
  - `POST /api/auto-follow/simulate`
  - `GET /api/auto-follow/history`
  - `GET /api/auto-follow/events`
- 数据结构: AutoFollowMode / 10 阶段 → 10 面板映射

### 验收标准
- [ ] 默认 mapping 生效
- [ ] 自定义 mapping 可配置
- [ ] 黑名单过滤工作
- [ ] 白名单过滤工作
- [ ] 9 阶段 + 10 面板映射全覆盖
- [ ] 服务端防刷屏（min_interval_s）
- [ ] SSE 事件正确推送
- [ ] 历史记录保留

---

## 测试执行策略

### 维度 1: UI 渲染
- 截图比对
- DOM 元素存在性
- 样式正确性

### 维度 2: 用户交互
- 真实点击/输入
- 表单提交
- 状态切换

### 维度 3: 数据流
- SSE 订阅成功
- 状态实时更新
- 事件正确推送

### 维度 4: 错误恢复
- 故障注入
- 异常路径
- 重试/降级

### 维度 5: 性能
- 加载时间 < 3s
- 响应延迟 < 500ms
- 资源占用

---

## 整体验收标准

- [ ] 5 个测试套件全部通过
- [ ] 截图覆盖率 100%
- [ ] 错误路径 100% 覆盖
- [ ] 性能基线达标
- [ ] TRAE-browseruse 真实执行（非 mock）
- [ ] 验收报告完整
