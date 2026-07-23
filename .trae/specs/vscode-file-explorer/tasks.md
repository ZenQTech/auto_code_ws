# Tasks

- [x] Task 1: 后端 workspace API
  - [x] 1.1 创建 `backend/app/api/workspace.py`，提供以下端点：
    - `GET /api/workspace/projects` — 列出 `workspace/` 下所有项目目录
    - `POST /api/workspace/projects` — 创建新项目目录
    - `GET /api/workspace/tree?project=xxx&path=xxx` — 返回目录树 JSON
    - `GET /api/workspace/file?project=xxx&path=xxx` — 返回文件内容
  - [x] 1.2 `api/__init__.py` 注册 workspace 路由

- [x] Task 2: 项目选择器组件
  - [x] 2.1 创建 `frontend/src/components/ProjectSelector.tsx` — 两个按钮卡片 + 项目名输入弹窗 + 已有项目列表
  - [x] 2.2 `App.tsx` 新增 `selectedProject` 状态，无项目时渲染 ProjectSelector

- [x] Task 3: 文件资源管理器组件
  - [x] 3.1 创建 `frontend/src/components/FileExplorer.tsx` — 树形目录组件
  - [x] 3.2 实现文件夹展开/折叠、文件图标映射、空目录提示
  - [x] 3.3 单击文件触发 onFileSelect(filePath) 回调

- [x] Task 4: 代码查看器组件
  - [x] 4.1 创建 `frontend/src/components/CodeViewer.tsx` — 代码展示组件
  - [x] 4.2 实现行号列 + 语法高亮（基于文件扩展名识别语言，关键字/字符串/注释着色）
  - [x] 4.3 支持关闭按钮，关闭时通知 App 恢复布局

- [x] Task 5: App.tsx 布局适配
  - [x] 5.1 编程模式下右侧面板渲染 FileExplorer
  - [x] 5.2 打开文件时：中间区域渲染 CodeViewer，左侧聊天框缩小至 Sidebar 顶部
  - [x] 5.3 关闭文件时：恢复默认布局

- [x] Task 6: useApi.ts 扩展
  - [x] 6.1 新增 `fetchProjects()` / `createProject(name)` / `fetchFileTree(project, path)` / `fetchFileContent(project, path)`

- [x] Task 7: 构建验证与测试
  - [x] 7.1 后端路由验证
  - [x] 7.2 前端 npm run build
  - [x] 7.3 更新代码修改日志

# Task Dependencies
- Task 1（后端 API）是所有前端任务的前置
- Task 2、Task 3、Task 4 可并行开发
- Task 5 依赖 Task 2、Task 3、Task 4
- Task 6 可与 Task 2-4 并行
- Task 7 依赖 Task 1-6 全部完成
