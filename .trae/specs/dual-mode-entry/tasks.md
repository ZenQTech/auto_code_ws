# Tasks

- [x] Task 1: Session 模型新增 mode 字段 + 数据库迁移
  - [x] 1.1 `models.py` Session 新增 `mode` 列（String, default='chat'）
  - [x] 1.2 `database.py` 新增 `sessions.mode` 列迁移逻辑
  - [x] 1.3 `types/index.ts` TypeScript Session 接口新增 `mode: 'chat' | 'coding'`

- [x] Task 2: 后端 API 支持 mode 过滤
  - [x] 2.1 `api/sessions.py` 创建会话接口接收 `mode` 参数
  - [x] 2.2 `api/sessions.py` 列表查询增加 `mode` 过滤参数
  - [x] 2.3 `services/hermes_service.py` 新建会话时写入 mode

- [x] Task 3: 前端模式选择页面
  - [x] 3.1 新建 `components/ModeSelector.tsx` — 两个大卡片选择入口
  - [x] 3.2 `App.tsx` 新增 `appMode` 状态（'chat'|'coding'|null），null 时渲染 ModeSelector
  - [x] 3.3 localStorage 存取 `app_mode` 偏好（跳过选择页）

- [x] Task 4: 前端侧边栏模式分组 + 切换
  - [x] 4.1 `Sidebar.tsx` 顶部新增模式切换控件（两个小按钮）
  - [x] 4.2 Sidebar 按 `appMode` 过滤会话列表（仅显示当前模式的会话）
  - [x] 4.3 新建会话按钮透传当前 `appMode`

- [x] Task 5: 前端模式感知界面适配
  - [x] 5.1 `App.tsx` 顶部栏显示当前模式标识（💬 日常办公闲聊 / ⚡ 编程模式）
  - [x] 5.2 闲聊模式下隐藏"优化提示词"按钮和 PlanViewer 面板
  - [x] 5.3 闲聊模式下 handleSendMessage 跳过优化/计划逻辑，仅发送对话

- [x] Task 6: useApi.ts 适配
  - [x] 6.1 `useSessions()` 支持 `mode` 查询参数
  - [x] 6.2 `createSession()` 支持 `mode` 参数

- [x] Task 7: 构建验证与测试
  - [x] 7.1 后端路由 + 模式过滤测试
  - [x] 7.2 前端 npm run build 验证
  - [x] 7.3 清理临时文件
  - [x] 7.4 更新代码修改日志

# Task Dependencies
- Task 1（模型变更）是所有后续任务的前置
- Task 2 依赖 Task 1
- Task 4、Task 6 可与 Task 3 并行开发
- Task 5 依赖 Task 3、Task 4
- Task 7 依赖 Task 1-6 全部完成
