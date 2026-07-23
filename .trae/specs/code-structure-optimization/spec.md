# 项目代码全局优化 Spec

## Why
通过全量代码审查发现项目存在以下关键问题：安全 API 路由缺失导致前端静默 404、两份配置文件重复维护、CLI 执行器代码 85% 重复、Toast 类型不传递、回收站天数前后端不一致等。需要系统性修复以提升代码质量、可维护性和运行时正确性。

## What Changes
- **修复**: 补全 `/api/security/` 路由端点（前端 SecurityReviewPanel 静默 404）
- **优化**: 合并 `settings.yaml` 与 `auto_code_config.yaml`，消除重复配置
- **重构**: 抽取 CLIExecutor/HermesExecutor 公共代码到 `base_executor.py`
- **修复**: Toast 组件支持 type 属性，各通知携带正确的类型样式
- **修复**: 回收站剩余天数从硬编码 30 天改为与后端一致的 7 天
- **统一**: 后端 service 包内导入统一为绝对导入 `from backend.app.config import settings`
- **优化**: `Sidebar.tsx` 移除空操作 `onOpenTrash` prop
- **BREAKING**: 无

## Impact
- Affected specs: chat-experience-optimization（Toast 扩展）、scheduling-platform-v4-full（security 路由补全）
- Affected code: `backend/app/api/security.py`(新建), `cli_integration/base_executor.py`(新建), `config/settings.yaml`(合并到 auto_code_config.yaml), `backend/app/config.py`, `cli_integration/executor.py`, `hermes_integration/hermes_executor.py`, `frontend/src/components/Toast.tsx`, `frontend/src/App.tsx`, `frontend/src/components/Sidebar.tsx`, 11 个 service 文件(导入统一)

---

## ADDED Requirements

### Requirement: 安全审核 API 路由补全
系统 SHALL 提供 `GET /api/security/review` 和 `POST /api/security/review` 端点，供前端 SecurityReviewPanel 查询和创建安全审核记录。

#### Scenario: 查询审核记录
- **WHEN** 前端调用 `GET /api/security/review?task_id=xxx`
- **THEN** 返回该任务的安全审核记录列表

#### Scenario: 创建审核记录
- **WHEN** 前端调用 `POST /api/security/review` 传入 module_name 和 risk_level
- **THEN** 调用 SecurityReviewManager.create_review 创建审核并返回记录

---

### Requirement: 配置文件合并
系统 SHALL 删除 `settings.yaml`，仅保留 `auto_code_config.yaml` 作为唯一配置文件，config.py 始终从该文件加载。

#### Scenario: 配置文件加载
- **WHEN** 系统启动且 `auto_code_config.yaml` 存在
- **THEN** 加载该文件

#### Scenario: 配置文件缺失
- **WHEN** `auto_code_config.yaml` 不存在
- **THEN** 使用 `_default_config()` 硬编码默认值启动，并记录 WARNING 日志

---

### Requirement: CLI 执行器公共基类
系统 SHALL 抽取 `CLIExecutor` 和 `HermesExecutor` 的公共逻辑到 `BaseCLIExecutor` 基类。

#### Scenario: 公共逻辑复用
- **WHEN** 需要调整超时处理或重试策略
- **THEN** 只需修改 `BaseCLIExecutor` 一处即可同时生效于 CLI 和 Hermes 执行器

---

### Requirement: Toast 类型传递
Toast 组件 SHALL 接受 `type` 属性并根据类型显示不同的图标和边框颜色。

#### Scenario: 错误类型通知
- **WHEN** 调用 `showToast('失败', 'error')`
- **THEN** Toast 显示红色边框 + X 图标

#### Scenario: 成功类型通知
- **WHEN** 调用 `showToast('完成', 'success')`
- **THEN** Toast 显示绿色边框 + 勾选图标

---

### Requirement: 回收站天数一致性
前端回收站剩余天数 SHALL 与后端保持一致（7 天），不再使用硬编码的 30 天。

#### Scenario: 回收站天数显示
- **WHEN** 会话删除 3 天
- **THEN** 回收站显示"剩余 4 天"

---

### Requirement: 导入风格统一
`backend/app/services/` 包内的 `from ..config import settings` SHALL 统一为 `from backend.app.config import settings`。

#### Scenario: 导入一致性
- **WHEN** 新增 service 模块
- **THEN** 使用绝对导入 `from backend.app.config import settings`

---

## REMOVED Requirements

### Requirement: Sidebar onOpenTrash prop
**Reason**: 该 prop 在 App.tsx 中对应空操作函数，Sidebar 内部自行管理回收站状态，无需从父组件传入。
**Migration**: 从 Sidebar Props 接口中移除 `onOpenTrash: () => void`，从 App.tsx 中移除对应的空回调。

### Requirement: config/settings.yaml 配置文件
**Reason**: 与 auto_code_config.yaml 包含 7 个完全相同的配置段，造成维护负担和二选一降级的不确定性。
**Migration**: 删除 settings.yaml，更新 config.py 移除降级逻辑。
