# P2-1 Playwright 前端 E2E 自动化 - 详细规格文档

## 1. 功能概述

### 1.1 背景
当前项目已实现完整的后端 API 端点和前端 UI 组件，但前端 E2E 自动化测试覆盖不足。Codex v0.135+ 引入了基于 Playwright 的端到端测试框架，支持 8 大核心场景、视觉回归基线、CI 集成等高级特性。本任务实现一个轻量级、独立的前端 E2E 自动化框架，零依赖 Playwright，使用 Selenium/Requests 混合方案完成核心场景验证。

### 1.2 目标
- 实现 8 大核心场景前端 E2E 自动化测试
- 提供视觉回归基线管理
- 集成到 GitHub Actions CI 流水线
- 生成 HTML/JSON/Markdown 多格式测试报告
- 提供失败自动截图与重试机制
- 完整的测试用例可被人工执行验证

### 1.3 用户场景
| 场景 | 描述 | 自动化价值 |
|------|------|----------|
| 用户登录 | 创建/选择 Session | 验证会话管理 |
| 双模式切换 | Chat ↔ Coding | 验证路由 |
| 项目创建 | 新建 AGV 项目 | 验证工作流 |
| 需求澄清 | 多轮对话澄清 | 验证 LLM 流式 |
| 架构设计 | 自动生成设计 | 验证 Modal |
| 任务派发 | SubAgent 分支 | 验证并发 |
| 错误恢复 | 网络中断重连 | 验证降级 |
| 验收测试 | 全链路回归 | 验证集成 |

## 2. 技术实现方案

### 2.1 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│            Playwright E2E 测试框架 (Cycle 11 P2-1)            │
├─────────────────────────────────────────────────────────────┤
│  Test Runner Layer (test runner 层)                          │
│  ├── PlaywrightE2ERunner (主调度器)                          │
│  ├── ScenarioRegistry (场景注册表)                            │
│  └── ResultAggregator (结果聚合)                              │
├─────────────────────────────────────────────────────────────┤
│  Scenario Layer (场景层)                                     │
│  ├── Scenario 1-8 (8 大核心场景)                              │
│  ├── BaseScenario (场景基类)                                  │
│  └── ScenarioContext (场景上下文)                              │
├─────────────────────────────────────────────────────────────┤
│  Driver Layer (驱动层 - 零依赖 Playwright)                    │
│  ├── BrowserDriver (浏览器驱动 - Chromium DevTools Protocol) │
│  ├── ApiDriver (API 驱动 - HTTP 客户端)                       │
│  └── HybridDriver (混合驱动 - 浏览器 + API)                  │
├─────────────────────────────────────────────────────────────┤
│  Foundation Layer (基础层)                                    │
│  ├── VisualRegression (视觉回归基线)                          │
│  ├── ReportGenerator (多格式报告生成)                         │
│  ├── ScreenshotCapture (失败自动截图)                         │
│  └── RetryStrategy (智能重试策略)                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心模块

#### 2.2.1 PlaywrightE2ERunner（主调度器）
- 负责加载所有场景、调度执行、聚合结果
- 支持串行/并行两种执行模式
- 提供 setup/teardown 钩子
- 内存状态管理（不依赖磁盘）

#### 2.2.2 BaseScenario（场景基类）
所有场景继承此基类，统一接口：
```python
class BaseScenario:
    name: str
    description: str
    priority: int  # 0-100,数字越大越优先
    timeout: int   # 秒
    
    async def setup(self) -> None: ...
    async def teardown(self) -> None: ...
    async def run(self, ctx: ScenarioContext) -> ScenarioResult: ...
    async def validate(self, ctx: ScenarioContext) -> bool: ...
```

#### 2.2.3 BrowserDriver（浏览器驱动）
- 使用 Chromium DevTools Protocol (CDP) 直接控制浏览器
- 零外部依赖（无需 Playwright/Puppeteer）
- 支持截图、点击、输入、滚动、等待等基本操作
- 智能等待（基于 CSS 选择器可见性）

#### 2.2.4 VisualRegression（视觉回归基线）
- 截图指纹计算（SHA-256）
- 基线存储（JSONL）
- 像素级差异对比（可选）
- 漂移阈值（默认 5%）

#### 2.2.5 ReportGenerator（报告生成器）
- 3 种格式：HTML（可读）、JSON（机器）、Markdown（GitHub）
- 测试摘要 + 详细结果 + 截图嵌入 + 错误堆栈
- 报告目录：`tests/e2e_reports/`

### 2.3 8 大核心场景

#### 场景 1: 应用启动 + 路由
- 访问根路径 → 验证 App.tsx 加载
- 路由到 /memory → 验证 MemoryPage 加载
- 路由到 /verification → 验证 VerificationPage 加载
- 路由到 /doctor → 验证 DoctorPage 加载
- 未匹配路由 → 重定向到 /

#### 场景 2: 模式选择 + 切换
- 首次启动显示 ModeSelector
- 选择 Chat 模式 → 进入 ChatHomePage
- 切换到 Coding 模式 → 进入 CodingHomePage
- 模式持久化到 localStorage

#### 场景 3: Session 管理
- 创建新 Session
- 列表展示
- 切换 Session
- 删除 Session
- localStorage 持久化

#### 场景 4: 消息发送 + 流式响应
- 输入消息
- 触发流式 API
- 验证 SSE 事件流
- 验证消息流式渲染
- 验证思考过程显示

#### 场景 5: 需求澄清
- 触发 /clarify 端点
- 接收结构化问题
- 渲染 ClarificationModal
- 提交回答
- 验证澄清完成

#### 场景 6: 架构设计
- 触发 /design/start
- 接收 requirementV2
- 渲染 ArchitectureDesignModal
- 确认/拒绝设计

#### 场景 7: Doctor 诊断
- 访问 /doctor
- 点击"运行诊断"
- 验证 6 大类诊断
- 验证修复建议
- 查看历史报告

#### 场景 8: 全链路回归
- 端到端：用户输入 → 需求澄清 → 架构设计 → 任务派发 → 验证
- 验证 SubAgent workspace 状态
- 验证 Git 提交触发
- 验证 /loop 工作流

### 2.4 验收指标

| 指标 | 目标值 | 测量方法 |
|------|-------|---------|
| 场景覆盖率 | 100% (8/8) | 单元测试 |
| 单场景通过率 | 100% | E2E 测试 |
| 报告生成成功率 | 100% | E2E 测试 |
| 视觉回归基线 | 3 个场景 | 单元测试 |
| CI 集成 | GitHub Actions 配置文件 | 文件存在性 |
| 截图捕获成功率 | 100% | 单元测试 |
| 重试机制 | 3 次 + 指数退避 | 单元测试 |
| 零外部依赖 | 100% | requirements.txt |

## 3. 接口设计规范

### 3.1 REST API（本框架对外暴露的）

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/e2e/health` | GET | 框架健康检查 |
| `/api/e2e/scenarios` | GET | 列出所有场景 |
| `/api/e2e/run` | POST | 执行测试（指定场景或全部） |
| `/api/e2e/scenarios/{id}/run` | POST | 执行单个场景 |
| `/api/e2e/reports` | GET | 列出历史报告 |
| `/api/e2e/reports/{id}` | GET | 获取报告详情 |
| `/api/e2e/baselines` | GET | 列出视觉基线 |
| `/api/e2e/baselines` | POST | 上传视觉基线 |
| `/api/e2e/baselines/{name}` | DELETE | 删除基线 |

### 3.2 Python SDK 接口

```python
from app.core.e2e import PlaywrightE2ERunner, BaseScenario

# 1. 注册自定义场景
class MyScenario(BaseScenario):
    name = "my_scenario"
    priority = 50
    async def run(self, ctx):
        ...

# 2. 运行测试
runner = PlaywrightE2ERunner()
runner.register(MyScenario)
result = await runner.run_all()

# 3. 视觉基线
from app.core.e2e import VisualRegression
vr = VisualRegression()
vr.capture_baseline("home_page", screenshot_bytes)
vr.compare("home_page", new_screenshot)
```

### 3.3 CLI 接口

```bash
# 健康检查
python -m app.core.e2e.cli health

# 列出场景
python -m app.core.e2e.cli list

# 运行所有场景
python -m app.core.e2e.cli run

# 运行指定场景
python -m app.core.e2e.cli run --scenario session_management

# 生成报告
python -m app.core.e2e.cli report --format html

# 基线管理
python -m app.core.e2e.cli baseline capture home_page
python -m app.core.e2e.cli baseline list
```

## 4. 数据结构定义

### 4.1 ScenarioContext
```python
@dataclass
class ScenarioContext:
    scenario_id: str
    start_time: datetime
    browser: BrowserDriver  # 浏览器驱动
    api: ApiDriver         # API 驱动
    state: Dict[str, Any]  # 场景间共享状态
    config: Dict[str, Any] # 测试配置
    artifacts_dir: Path    # 产物目录
```

### 4.2 ScenarioResult
```python
@dataclass
class ScenarioResult:
    scenario_id: str
    scenario_name: str
    status: str  # passed/failed/error/skipped
    start_time: datetime
    end_time: datetime
    duration_ms: int
    steps: List[StepResult]
    screenshots: List[str]  # 截图路径
    error: Optional[str]
    error_stack: Optional[str]
    metadata: Dict[str, Any]
```

### 4.3 TestReport
```python
@dataclass
class TestReport:
    report_id: str
    timestamp: datetime
    duration_ms: int
    total_scenarios: int
    passed: int
    failed: int
    error: int
    skipped: int
    results: List[ScenarioResult]
    metadata: Dict[str, Any]
```

## 5. 性能与安全要求

### 5.1 性能要求
- 单场景超时：60s（可配置）
- 总测试超时：10min
- 截图捕获：< 500ms/张
- 报告生成：< 1s
- 视觉基线对比：< 200ms

### 5.2 安全要求
- 路径白名单：仅访问项目内目录
- 浏览器沙箱：禁用危险操作（系统命令、网络外联）
- API 调用：仅访问 localhost
- 截图脱敏：自动检测并遮盖密码字段
- 命令白名单：禁止 `rm -rf` 等危险操作

## 6. 验收标准

### 6.1 单元测试（≥ 25 个用例）
- ScenarioRegistry 注册/查询
- BaseScenario 生命周期
- VisualRegression 指纹计算
- VisualRegression 基线 CRUD
- ReportGenerator 3 种格式
- ScreenshotCapture 截图捕获
- RetryStrategy 重试逻辑
- ApiDriver HTTP 调用
- BrowserDriver 元素操作

### 6.2 E2E 测试（≥ 30 个断言）
- 8 大核心场景全部通过
- 报告生成成功
- 视觉基线对比正确
- 失败自动截图

### 6.3 CI 集成
- `.github/workflows/e2e.yml` 文件存在
- 配置包含所有 8 个场景
- 失败时上传报告 artifact

### 6.4 文档完整性
- README.md
- spec.md（本文件）
- task.md
- checklist.md

## 7. 风险与缓解

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| 浏览器驱动不稳定 | 中 | 重试 3 次 + 智能等待 |
| 视觉基线漂移 | 低 | 阈值 5% + 人工审核 |
| CI 环境差异 | 中 | Docker 容器化 |
| 异步竞态 | 中 | 串行执行 + 超时控制 |

## 8. 与已有系统集成

- **Doctor 系统**：场景 7 直接调用 doctor API
- **Memory 系统**：场景 4 验证记忆持久化
- **Verification Loop**：场景 8 触发 P1-10
- **Loop Engineering**：场景 8 端到端验证 /loop

## 9. 复用声明

- 复用 `tests/test_e2e_*.sh` 测试模式
- 复用 `pytest` 测试框架与 fixture 机制
- 复用 Pydantic 数据模型
- 不复用任何 Playwright/Selenium 外部依赖（保持零外部依赖）
- 不复用任何商业闭源组件

## 10. 修改记录

- 2026-07-28 | v1.0.0 | Cycle 11 P2-1 新建详细规格文档
