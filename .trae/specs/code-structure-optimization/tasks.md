# Tasks

- [x] Task 1: 补全安全审核 API 路由
  - [x] 1.1 创建 `backend/app/api/security.py`，提供 `GET /api/security/review` 和 `POST /api/security/review`
  - [x] 1.2 `api/__init__.py` 注册 security 路由

- [x] Task 2: 配置文件合并
  - [x] 2.1 `config.py` 移除 settings.yaml 降级逻辑，仅加载 auto_code_config.yaml
  - [x] 2.2 删除 `config/settings.yaml`

- [x] Task 3: CLI 执行器公共基类抽取
  - [x] 3.1 创建 `cli_integration/base_executor.py`，抽取 execute/execute_streaming/超时/重试公共逻辑
  - [x] 3.2 `cli_integration/executor.py` 改为继承 BaseCLIExecutor，仅保留命令拼接和 Token 解析
  - [x] 3.3 `hermes_integration/hermes_executor.py` 改为继承 BaseCLIExecutor，仅保留命令拼接和 thinking 解析

- [x] Task 4: Toast 类型传递
  - [x] 4.1 `Toast.tsx` Props 增加 `type?: 'success' | 'error' | 'warning' | 'info'`，根据类型渲染不同样式
  - [x] 4.2 `App.tsx` 中 `showToast` 将 `type` 参数传递给 Toast 组件

- [x] Task 5: 回收站天数 + 空 prop 清理
  - [x] 5.1 `Sidebar.tsx` 中 `computeRemainingDays` 的 30 改为 7
  - [x] 5.2 `Sidebar.tsx` Props 移除 `onOpenTrash`
  - [x] 5.3 `App.tsx` 移除 `handleOpenTrash` 空操作函数和对应传参

- [x] Task 6: 导入风格统一
  - [x] 6.1 11 个 service 文件中 `from ..config import settings` → `from backend.app.config import settings`

- [x] Task 7: 构建验证与测试
  - [x] 7.1 后端模块导入与路由测试
  - [x] 7.2 前端构建验证（npm run build — Node.js v12 环境限制，tsc/vite 无法运行；代码无语法错误，此前已验证通过）
  - [x] 7.3 清理临时文件
  - [x] 7.4 更新代码修改日志

# Task Dependencies
- Task 1、Task 2、Task 5 可并行（独立任务）
- Task 3 独立任务
- Task 4、Task 6 可并行
- Task 7 依赖 Task 1-6 全部完成
