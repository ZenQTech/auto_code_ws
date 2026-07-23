# Tasks

- [x] Task 1: 后端 Session 模型回退
  - 1.1 在 `backend/app/models.py` 移除 `Session.title_auto_generated` 字段（或保留字段但加 deprecation 注释，前端不再使用）
  - 1.2 在 `backend/app/api/sessions.py` 移除 `SessionResponse.title_auto_generated` 字段
  - 1.3 在 `_session_to_response` 中移除 `title_auto_generated=session.title_auto_generated or False`

- [x] Task 2: 数据库迁移回退
  - 2.1 在 `backend/app/database.py` 移除 `_run_legacy_migration` 中关于 `title_auto_generated` 列的检查与 `ALTER TABLE` 语句
  - 2.2 移除数据回填 `UPDATE sessions SET title_auto_generated = 1 WHERE ...`
  - 2.3 **可选保留**：列已存在时不删除（避免破坏数据），但新代码不再写该列

- [x] Task 3: 后端 auto-title 端点移除
  - 3.1 在 `backend/app/api/sessions.py` 移除 `AutoTitleRequest` / `AutoTitleResponse` Pydantic 模型
  - 3.2 移除 `POST /{session_id}/auto-title` 端点（连同其函数体、docstring、imports）
  - 3.3 移除该端点对应的 logger.info 引用

- [x] Task 4: Hermes 服务层回退
  - 4.1 在 `backend/app/services/hermes_service.py` 移除 `_generate_session_title` 私有方法
  - 4.2 移除 `_update_session_title` 公共助手（如果只被自动命名使用）
  - 4.3 在 `chat_with_hermes_streaming` 的 done 事件 yield 中移除 title 字段，恢复为 `{"type": "done"}`
  - 4.4 移除 SSE 触发自动命名的判断逻辑（`title_auto_generated=False` 检查）

- [x] Task 5: 前端 SSE 解析回退
  - [x] 5.1 在 `frontend/src/hooks/useApi.ts` 把 `onDone` 签名从 `(title?: string) => void` 改回 `() => void`
  - [x] 5.2 主 while 循环内 `case 'done'` 与末尾 buffer 处理处的 `onDone?.(event.title)` 改回 `onDone?.()`
  - [x] 5.3 移除 JSDoc 中关于"v1.3.0 调整 onDone 接收 title"的说明
  - [x] 5.4 文件头 v1.3.0 修改记录改为 v1.4.0 "onDone 回调签名回退为 () => void（撤销 auto-session-title-generation）"

- [x] Task 6: 前端 App.tsx 移除自动写回
  - [x] 6.1 在 `App.tsx` 的 `onDone` 回调中移除 `await updateSession + setSessions` 自动写回 title 的代码块
  - [x] 6.2 保留原有逻辑（status / isSending / streamingMessageId / thinking / setTimeout / refetchSessions）
  - [x] 6.3 文件头 v2.5.0 修改记录改为 v2.6.0 "移除 onDone 自动写回 title（撤销 auto-session-title-generation）"
  - [x] 6.4 **如果 v2.5.0 引入了 sessions 本地 state**（用 useState 镜像 serverSessions），保留该 state 用于 Sidebar 实时刷新，但**不**再在 onDone 中更新 title 字段

- [x] Task 7: 前端 SessionListItem 派生计算 displayTitle
  - [x] 7.1 在 `frontend/src/components/SessionListItem.tsx` 引入 `useMemo` 或简单三元运算符计算 `displayTitle`
  - [x] 7.2 渲染处用 `displayTitle` 替代原 `{session.title}`
  - [x] 7.3 应用 Tailwind `truncate` 类实现单行省略号
  - [x] 7.4 消息数徽章在 `message_count === 0` 时不显示
  - [x] 7.5 文件头 v1.0.0 修改记录改为 v1.1.0 "displayTitle 派生计算（撤销 AI 总结，纯前端截取显示）"

- [x] Task 8: 文档与代码修改日志
  - 8.1 在 `/home/qizheng/auto_code_ws/代码修改日志.md` 追加 v2.5.0 / v1.4.0 / v1.1.0 等版本号记录"撤销 auto-session-title-generation"
  - 8.2 标注 `auto-session-title-generation` spec 为 SUPERSEDED（被本 spec 取代）

- [x] Task 9: 构建与回归验证
  - 9.1 后端 `python3 -c "from backend.app.main import app; print('OK')"` 启动无报错
  - 9.2 前端 `npm run build` 无编译错误
  - 9.3 GUI 端到端：新 Session 显示"新对话"占位；用户发送首条消息后侧边栏显示"首条消息开头+..."（单行省略号）；用户手动重命名后保留手动 title
  - 9.4 验证后端 `_generate_session_title` 不再被调用（grep 源码无引用）
  - 9.5 验证 SSE done 事件 payload 不再含 title 字段（grep 源码无 yield 包含 title）

# Task Dependencies
- Task 1（模型回退）是后端任务的前置
- Task 2（迁移回退）依赖 Task 1
- Task 3（端点移除）独立
- Task 4（Hermes 回退）依赖 Task 1
- Task 5（前端 SSE 解析）独立
- Task 6（App 移除）依赖 Task 5
- Task 7（SessionListItem 派生）独立
- Task 8（日志）依赖 Task 1-7 完成
- Task 9（验证）依赖 Task 1-8 全部完成
