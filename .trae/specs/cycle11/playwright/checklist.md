# P2-1 Playwright E2E 验收清单

## 功能完整性

### 核心模块
- [x] `backend/app/core/e2e/__init__.py` 已创建
- [x] `backend/app/core/e2e/base.py` 数据模型完整
- [x] `backend/app/core/e2e/api_driver.py` HTTP 驱动
- [x] `backend/app/core/e2e/browser_driver.py` 浏览器驱动（零依赖）
- [x] `backend/app/core/e2e/scenario.py` 场景基类
- [x] `backend/app/core/e2e/scenarios/s1_app_startup.py` 场景 1
- [x] `backend/app/core/e2e/scenarios/s2_mode_switch.py` 场景 2
- [x] `backend/app/core/e2e/scenarios/s3_session_management.py` 场景 3
- [x] `backend/app/core/e2e/scenarios/s4_message_streaming.py` 场景 4
- [x] `backend/app/core/e2e/scenarios/s5_clarification.py` 场景 5
- [x] `backend/app/core/e2e/scenarios/s6_architecture_design.py` 场景 6
- [x] `backend/app/core/e2e/scenarios/s7_doctor_diagnosis.py` 场景 7
- [x] `backend/app/core/e2e/scenarios/s8_e2e_regression.py` 场景 8
- [x] `backend/app/core/e2e/visual.py` 视觉回归基线
- [x] `backend/app/core/e2e/report.py` 多格式报告
- [x] `backend/app/core/e2e/runner.py` 主调度器
- [x] `backend/app/core/e2e/retry.py` 重试策略
- [x] `backend/app/core/e2e/cli.py` CLI 工具

### API 端点
- [x] `backend/app/api/e2e.py` REST API（9 个端点）
- [x] 在 main.py 中注册 e2e_router

### CI 集成
- [x] `.github/workflows/e2e.yml` GitHub Actions 配置

## 测试覆盖

### 单元测试（≥ 25 个）
- [x] ScenarioContext/Result/Report 数据类
- [x] E2EConfig 配置加载
- [x] ApiDriver GET/POST/超时/重试
- [x] BrowserDriver 启动/导航/截图
- [x] BaseScenario setup/run/teardown
- [x] ScenarioRegistry register/get/list
- [x] VisualRegression 指纹/CRUD
- [x] ReportGenerator HTML/JSON/Markdown
- [x] ScreenshotCapture 截图
- [x] RetryStrategy 重试逻辑
- [x] 工具函数（路径白名单等）

### E2E 测试（≥ 30 个）
- [x] 健康检查
- [x] 场景列表（8 个）
- [x] 单场景执行
- [x] 全场景执行
- [x] 报告生成（3 种格式）
- [x] 视觉基线 CRUD
- [x] 失败自动截图
- [x] 重试机制
- [x] 错误路径

## 质量指标

### 性能
- [x] 单场景超时：60s
- [x] 总测试超时：10min
- [x] 截图捕获：< 500ms/张
- [x] 报告生成：< 1s
- [x] 视觉基线对比：< 200ms

### 安全
- [x] 路径白名单
- [x] 浏览器沙箱
- [x] API 仅访问 localhost
- [x] 截图脱敏
- [x] 命令白名单

### 兼容性
- [x] Python 3.10
- [x] FastAPI
- [x] pytest
- [x] 零外部依赖（无 Playwright/Selenium）

## 8 大核心场景验收

### 场景 1: 应用启动 + 路由
- [x] 根路径加载
- [x] /memory 路由
- [x] /verification 路由
- [x] /doctor 路由
- [x] /diff-view 路由
- [x] 兜底重定向

### 场景 2: 模式选择 + 切换
- [x] ModeSelector 显示
- [x] Chat 模式切换
- [x] Coding 模式切换
- [x] localStorage 持久化

### 场景 3: Session 管理
- [x] 创建新 Session
- [x] Session 列表
- [x] 切换 Session
- [x] 删除 Session
- [x] 自动恢复（last_session_id）

### 场景 4: 消息发送 + 流式响应
- [x] 消息输入
- [x] SSE 流式 API
- [x] 流式渲染
- [x] 思考过程显示

### 场景 5: 需求澄清
- [x] /clarify 触发
- [x] 结构化问题
- [x] ClarificationModal
- [x] 回答提交
- [x] 澄清完成

### 场景 6: 架构设计
- [x] /design/start
- [x] requirementV2
- [x] ArchitectureDesignModal
- [x] 确认/拒绝

### 场景 7: Doctor 诊断
- [x] /doctor 访问
- [x] 6 大类诊断
- [x] 修复建议
- [x] 历史报告

### 场景 8: 全链路回归
- [x] 用户输入 → 澄清
- [x] 澄清 → 设计
- [x] 设计 → 派发
- [x] SubAgent workspace
- [x] Git 提交触发
- [x] /loop 工作流

## 文档完整性

- [x] spec.md 详细规格（≥ 10 节）
- [x] task.md 任务清单
- [x] checklist.md 验收清单
- [x] README.md 使用文档

## 集成验收

- [x] 与 Doctor 系统集成
- [x] 与 Memory 系统集成
- [x] 与 Verification Loop 集成
- [x] 与 Loop Engineering 集成

## 最终验收

- [x] 单元测试 100% 通过
- [x] E2E 测试 100% 通过
- [x] TypeScript 编译 0 错误
- [x] CI 配置文件存在
- [x] 代码修改日志更新
- [x] CYCLE11_SUMMARY 更新
- [x] Git 提交完成

## 通过标准

所有复选框全部勾选，单元测试 + E2E 测试通过率达到 100%，无关键 bug，次要 bug 数量为 0，方可认为 P2-1 Playwright E2E 自动化任务完成。
