# Tasks

- [x] Task 1: 后端 Session 模型升级（软删除支持）
  - [x] 1.1 `models.py` 新增 `SessionStatus.DELETED` 枚举值，`Session` 新增 `deleted_at` 字段（DateTime, nullable）
  - [x] 1.2 `database.py` 新增启动时迁移：`ALTER TABLE sessions ADD COLUMN deleted_at DATETIME`

- [x] Task 2: 后端批量删除与回收站 API
  - [x] 2.1 `api/sessions.py` 新增 `POST /api/sessions/batch-delete` — 接收 `session_ids: List[str]`，软删除（标记 deleted + 写入 deleted_at）
  - [x] 2.2 `api/sessions.py` 新增 `GET /api/sessions/trash` — 返回 status=deleted 的会话列表
  - [x] 2.3 `api/sessions.py` 新增 `POST /api/sessions/trash/restore` — 接收 `session_ids`，恢复为 active
  - [x] 2.4 `api/sessions.py` 新增 `DELETE /api/sessions/trash/empty` — 清空回收站（硬删除所有 deleted 会话）
  - [x] 2.5 `api/sessions.py` 修改 `DELETE /api/sessions/{id}` 单条删除 → 改为软删除
  - [x] 2.6 创建 `backend/app/services/trash_cleaner.py` 后台清理服务：每 60 分钟扫描一次，硬删除 deleted_at > 7 天的会话
  - [x] 2.7 `main.py` 启动时注册 trash_cleaner 后台任务

- [x] Task 3: 后端配置读写 API
  - [x] 3.1 创建 `backend/app/api/config_endpoint.py` — `GET /api/config` 读取配置 + `PUT /api/config` 写入配置
  - [x] 3.2 `api/__init__.py` 注册 config 路由

- [x] Task 4: 前端新建对话按钮禁用逻辑
  - [x] 4.1 `App.tsx` 中 `handleNewTask` 增加判断：若 `messages.length === 0` 则直接 return
  - [x] 4.2 `App.tsx` 中新建按钮根据 `messages.length === 0` 动态设置 disabled/样式

- [x] Task 5: 前端批量删除功能
  - [x] 5.1 `Sidebar.tsx` 新增批量删除模式状态（`batchMode`、`selectedIds`），顶部工具栏增加"批量删除"入口按钮
  - [x] 5.2 `Sidebar.tsx` 批量模式下渲染"取消"/"删除所选(X)"操作栏
  - [x] 5.3 `SessionListItem.tsx` 新增 Props: `batchMode: boolean`、`checked: boolean`、`onCheck: () => void`
  - [x] 5.4 `SessionListItem.tsx` 批量模式下渲染复选框（前面一行），点击触发 onCheck
  - [x] 5.5 `App.tsx` 新增 `handleBatchDelete` 回调，调用 `POST /api/sessions/batch-delete`，刷新列表
  - [x] 5.6 `hooks/useApi.ts` 新增 `batchDeleteSessions(ids)` / `restoreSessions(ids)` / `emptyTrash()` / `fetchTrashSessions()` API 函数

- [x] Task 6: 前端回收站面板
  - [x] 6.1 `Sidebar.tsx` 底部新增"回收站"入口按钮（垃圾桶图标 + 徽章显示条数）
  - [x] 6.2 点击回收站入口 → 侧边栏切换为回收站视图（显示 deleted 会话列表 + "清空回收站"按钮）
  - [x] 6.3 回收站中每项显示标题、删除时间、剩余天数、"恢复"按钮

- [x] Task 7: 前端设置页面
  - [x] 7.1 创建 `frontend/src/components/SettingsPanel.tsx` 设置面板组件
  - [x] 7.2 从 `GET /api/config` 加载当前配置，分组展示（可折叠）
  - [x] 7.3 每个配置项显示标签、当前值、输入组件（string→text, int→number, bool→toggle）
  - [x] 7.4 "保存"按钮调用 `PUT /api/config`，成功后显示 Toast
  - [x] 7.5 `App.tsx` 新增 `settingsOpen` 状态，设置模式时渲染 SettingsPanel 替代对话区
  - [x] 7.6 `Sidebar.tsx` 底部"设置"按钮点击 → `App.tsx` 打开设置页

- [x] Task 8: 集成测试与验证
  - [x] 8.1 后端 Session 模型迁移测试
  - [x] 8.2 软删除/批量删除/回收站/恢复 API 测试
  - [x] 8.3 配置读写 API 测试
  - [x] 8.4 前端构建验证（npm run build exit 0，35 模块，0 错 0 警）
  - [x] 8.5 清理临时测试文件
  - [x] 8.6 更新代码修改日志

# Task Dependencies
- All tasks completed. 8/8 tasks done, all verifications passed.
