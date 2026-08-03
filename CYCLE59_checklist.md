# CYCLE 59 验收检查清单

> **日期**: 2026-08-03
> **目标**: 5 大 P0 任务 TRAE-browseruse 端到端测试验收

---

## 全局检查项

### 基础设施
- [x] 后端服务运行正常（http://localhost:8765/health）
- [x] 前端服务运行正常（http://localhost:5173）
- [x] C58 任务全部完成
- [x] G58 API 全部可访问

### 测试环境
- [ ] TRAE-browseruse 可调用
- [ ] 浏览器引擎已安装
- [ ] 测试脚本目录 `e2e/` 已创建
- [ ] 截图目录 `e2e/screenshots/` 已创建

---

## G59-01: VibeCoding 流程 E2E 检查清单

### UI 渲染
- [ ] 首页加载完成
- [ ] 3 模式卡片可见
- [ ] vibe-coding 卡片可点击

### 路由
- [ ] 点击后跳转到 /vibe-coding
- [ ] VibeCodingPage 正确渲染
- [ ] LoopStatusBar 显示
- [ ] 多个 panel 网格布局正确

### 交互
- [ ] prompt 输入框可输入
- [ ] 开始按钮可点击
- [ ] 暂停/恢复/取消按钮可点击

### 状态机
- [ ] idle 状态显示
- [ ] clarifying 状态显示
- [ ] planning 状态显示
- [ ] executing 状态显示
- [ ] done 状态显示

### 数据流
- [ ] SSE 连接成功
- [ ] 状态变更实时推送
- [ ] 步骤变更实时推送

### 截图
- [ ] 首页截图
- [ ] VibeCodingPage 截图
- [ ] 各阶段状态截图

---

## G59-02: ComposerPlan 执行 E2E 检查清单

### Plan 创建
- [ ] UI 表单可填写
- [ ] 创建按钮可点击
- [ ] 创建成功后跳转到详情页

### 步骤依赖
- [ ] 3 步骤带依赖的 Plan
- [ ] 步骤顺序正确（a→b→c）
- [ ] 并行步骤正确

### 控制
- [ ] 启动按钮工作
- [ ] 暂停按钮工作
- [ ] 恢复按钮工作
- [ ] 取消按钮工作

### 错误恢复
- [ ] 失败步骤可重试
- [ ] 失败步骤可跳过

### SSE
- [ ] 步骤状态变更推送
- [ ] Plan 状态变更推送

---

## G59-03: LoopStateMachine 状态机 E2E 检查清单

### 状态枚举
- [ ] idle ✓
- [ ] clarifying ✓
- [ ] designing ✓
- [ ] prompting ✓
- [ ] executing ✓
- [ ] reviewing ✓
- [ ] done ✓
- [ ] paused ✓
- [ ] error ✓
- [ ] cancelled ✓

### 迁移规则
- [ ] IDLE → CLARIFYING 允许
- [ ] IDLE → EXECUTING 拒绝
- [ ] DONE → IDLE 拒绝
- [ ] force=True 可强制

### 显示
- [ ] LoopStatusBar 实时更新
- [ ] 进度条 0-1
- [ ] ETA 显示
- [ ] 历史记录

---

## G59-04: ClaudeCodeShell E2E 检查清单

### CLI 探测
- [ ] is_available() 返回正确
- [ ] PATH 检测正确

### 真实调用
- [ ] echo "hello" 成功
- [ ] stdout 流式输出
- [ ] exit_code 正确

### 安全
- [ ] 路径净化生效
- [ ] 超时熔断生效
- [ ] 注入字符过滤

### 降级
- [ ] CLI 不在 PATH 时降级
- [ ] LLM HTTP 备用路径

---

## G59-05: Auto-Follow 联动 E2E 检查清单

### 默认配置
- [ ] IDLE → progressOverview
- [ ] CLARIFYING → agentChat
- [ ] DESIGNING → architecture
- [ ] PROMPTING → planExecutor
- [ ] EXECUTING → vibeCoding
- [ ] REVIEWING → diffView
- [ ] DONE → progressOverview
- [ ] PAUSED → progressOverview
- [ ] ERROR → loopState
- [ ] CANCELLED → loopState

### 自定义配置
- [ ] custom_mapping 可设置
- [ ] 修改后立即生效
- [ ] 优先级高于默认

### 过滤
- [ ] 黑名单生效
- [ ] 白名单生效

### 性能
- [ ] 服务端防刷屏（min_interval_s）
- [ ] SSE 事件去重

---

## 最终验收

- [ ] 5 个测试套件 100% 通过
- [ ] 截图覆盖率 100%
- [ ] 错误路径 100% 覆盖
- [ ] 性能基线达标
- [ ] 验收报告完整
- [ ] 准备推送到 main 分支
