# P2-1 Playwright E2E 任务清单

## 模块 1: 核心数据模型与基础类

### 1.1 场景上下文与结果数据类
- [ ] 创建 `backend/app/core/e2e/__init__.py`
- [ ] 创建 `backend/app/core/e2e/base.py`
  - [ ] ScenarioContext 数据类
  - [ ] ScenarioResult 数据类
  - [ ] TestReport 数据类
  - [ ] StepResult 数据类
  - [ ] E2EConfig 配置类
  - [ ] Status 常量 (passed/failed/error/skipped)

### 1.2 工具函数
- [ ] 报告 ID 生成
- [ ] 截图路径生成
- [ ] 时间戳格式化
- [ ] JSON 序列化辅助
- [ ] 路径白名单校验

## 模块 2: 浏览器驱动（零依赖）

### 2.1 ApiDriver
- [ ] 创建 `backend/app/core/e2e/api_driver.py`
- [ ] GET/POST/PUT/DELETE 方法
- [ ] JSON 请求/响应处理
- [ ] 超时控制
- [ ] 重试机制（指数退避）
- [ ] 错误处理与日志

### 2.2 BrowserDriver（基于 CDP）
- [ ] 创建 `backend/app/core/e2e/browser_driver.py`
- [ ] 启动/关闭浏览器
- [ ] 导航到 URL
- [ ] 元素定位（CSS selector）
- [ ] 点击/输入/滚动/等待
- [ ] 截图捕获（PNG）
- [ ] 评估 JavaScript
- [ ] Cookie/LocalStorage 管理

## 模块 3: 场景基类与注册表

### 3.1 BaseScenario
- [ ] 创建 `backend/app/core/e2e/scenario.py`
- [ ] setup/teardown 生命周期
- [ ] run 主方法
- [ ] validate 验证方法
- [ ] 步骤执行器（step context）
- [ ] 错误捕获与重试

### 3.2 ScenarioRegistry
- [ ] 场景注册（register）
- [ ] 按名称查询（get）
- [ ] 列出所有（list）
- [ ] 按优先级排序
- [ ] 去重

## 模块 4: 8 大核心场景实现

### 4.1 场景 1: 应用启动 + 路由
- [ ] 创建 `backend/app/core/e2e/scenarios/s1_app_startup.py`
- [ ] 验证根路径加载
- [ ] 验证 4 个独立页面路由（/memory, /verification, /doctor, /diff-view）
- [ ] 验证未匹配路由重定向

### 4.2 场景 2: 模式选择 + 切换
- [ ] 创建 `backend/app/core/e2e/scenarios/s2_mode_switch.py`
- [ ] 验证 ModeSelector 显示
- [ ] 验证 Chat/Coding 模式切换
- [ ] 验证 localStorage 持久化

### 4.3 场景 3: Session 管理
- [ ] 创建 `backend/app/core/e2e/scenarios/s3_session_management.py`
- [ ] 验证创建新 Session
- [ ] 验证 Session 列表
- [ ] 验证切换 Session
- [ ] 验证删除 Session

### 4.4 场景 4: 消息发送 + 流式响应
- [ ] 创建 `backend/app/core/e2e/scenarios/s4_message_streaming.py`
- [ ] 验证消息输入
- [ ] 验证 SSE 流式 API
- [ ] 验证消息流式渲染
- [ ] 验证思考过程显示

### 4.5 场景 5: 需求澄清
- [ ] 创建 `backend/app/core/e2e/scenarios/s5_clarification.py`
- [ ] 触发 /clarify 端点
- [ ] 验证结构化问题
- [ ] 验证 ClarificationModal
- [ ] 验证回答提交

### 4.6 场景 6: 架构设计
- [ ] 创建 `backend/app/core/e2e/scenarios/s6_architecture_design.py`
- [ ] 触发 /design/start
- [ ] 验证 requirementV2
- [ ] 验证 ArchitectureDesignModal
- [ ] 验证确认/拒绝

### 4.7 场景 7: Doctor 诊断
- [ ] 创建 `backend/app/core/e2e/scenarios/s7_doctor_diagnosis.py`
- [ ] 访问 /doctor
- [ ] 验证 6 大类诊断
- [ ] 验证修复建议
- [ ] 验证历史报告

### 4.8 场景 8: 全链路回归
- [ ] 创建 `backend/app/core/e2e/scenarios/s8_e2e_regression.py`
- [ ] 用户输入 → 需求澄清 → 架构设计 → 任务派发
- [ ] 验证 SubAgent workspace
- [ ] 验证 Git 提交触发
- [ ] 验证 /loop 工作流

## 模块 5: 视觉回归基线

### 5.1 视觉指纹
- [ ] 创建 `backend/app/core/e2e/visual.py`
- [ ] SHA-256 指纹计算
- [ ] 像素级差异（可选）
- [ ] 漂移阈值（默认 5%）

### 5.2 基线管理
- [ ] 基线存储（JSONL）
- [ ] 基线 CRUD
- [ ] 基线对比
- [ ] 漂移报告

## 模块 6: 报告生成

### 6.1 多格式报告
- [ ] 创建 `backend/app/core/e2e/report.py`
- [ ] HTML 报告生成
- [ ] JSON 报告生成
- [ ] Markdown 报告生成（GitHub 友好）
- [ ] 截图嵌入（base64）

### 6.2 报告聚合
- [ ] 多场景结果聚合
- [ ] 通过率统计
- [ ] 错误摘要
- [ ] 趋势分析

## 模块 7: 主调度器

### 7.1 PlaywrightE2ERunner
- [ ] 创建 `backend/app/core/e2e/runner.py`
- [ ] 加载所有场景
- [ ] 串行/并行执行
- [ ] setup/teardown 编排
- [ ] 结果聚合
- [ ] 报告生成触发

### 7.2 重试策略
- [ ] 创建 `backend/app/core/e2e/retry.py`
- [ ] 指数退避（1s, 5s, 15s）
- [ ] 最多 3 次重试
- [ ] 错误分类

## 模块 8: REST API

### 8.1 API 端点
- [ ] 创建 `backend/app/api/e2e.py`
- [ ] GET /health
- [ ] GET /scenarios
- [ ] POST /run
- [ ] POST /scenarios/{id}/run
- [ ] GET /reports
- [ ] GET /reports/{id}
- [ ] GET /baselines
- [ ] POST /baselines
- [ ] DELETE /baselines/{name}

### 8.2 注册到 main.py
- [ ] 修改 `backend/app/main.py`
- [ ] 注册 e2e_router

## 模块 9: CLI 接口

### 9.1 命令行工具
- [ ] 创建 `backend/app/core/e2e/cli.py`
- [ ] health 子命令
- [ ] list 子命令
- [ ] run 子命令
- [ ] report 子命令
- [ ] baseline 子命令

## 模块 10: CI 集成

### 10.1 GitHub Actions
- [ ] 创建 `.github/workflows/e2e.yml`
- [ ] 触发条件（push, PR）
- [ ] 8 个场景并行执行
- [ ] 失败时上传报告

## 模块 11: 测试

### 11.1 单元测试
- [ ] 创建 `tests/test_e2e_units.py`
- [ ] 25+ 单元测试用例

### 11.2 E2E 测试
- [ ] 创建 `tests/test_e2e_playwright.sh`
- [ ] 30+ E2E 断言

## 模块 12: 文档

### 12.1 README
- [ ] 创建 `backend/app/core/e2e/README.md`
- [ ] 安装说明
- [ ] 使用示例
- [ ] CI 集成

## 验收清单

- [ ] 所有模块实现完成
- [ ] 25+ 单元测试通过
- [ ] 30+ E2E 断言通过
- [ ] 8 大场景全部通过
- [ ] TypeScript 编译 0 错误
- [ ] CI 配置文件存在
- [ ] README 完整
- [ ] 代码修改日志更新
- [ ] CYCLE11_SUMMARY 更新
- [ ] Git 提交完成
