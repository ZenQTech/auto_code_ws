# Checklist

## Task 1 — 后端 Session 模型回退
- [x] `Session` 模型 `title_auto_generated` 字段已移除（或标记为 deprecated）
- [x] `SessionResponse.title_auto_generated` 字段已移除
- [x] `_session_to_response` 转换函数不再返回该字段

## Task 2 — 数据库迁移回退
- [x] `_run_legacy_migration` 中关于 `title_auto_generated` 列的检查与 ALTER TABLE 已移除
- [x] 数据回填 UPDATE 语句已移除

## Task 3 — 后端 auto-title 端点移除
- [x] `AutoTitleRequest` / `AutoTitleResponse` Pydantic 模型已删除
- [x] `POST /{session_id}/auto-title` 端点已删除
- [x] 相关 imports 已清理

## Task 4 — Hermes 服务层回退
- [x] `_generate_session_title` 私有方法已删除
- [x] `_update_session_title` 公共助手已删除
- [x] `chat_with_hermes_streaming` 的 done 事件 payload 恢复为 `{"type": "done"}`（不含 title）
- [x] SSE 触发自动命名的判断逻辑已移除

## Task 5 — 前端 SSE 解析回退
- [x] `chatWithHermesStreaming` 的 `onDone` 签名回退为 `() => void`
- [x] `onDone?.(event.title)` 已改为 `onDone?.()`
- [x] JSDoc 中 v1.3.0 调整说明已移除
- [x] 文件头版本号改为 v1.4.0

## Task 6 — 前端 App.tsx 移除自动写回
- [x] `onDone` 中 `await updateSession + setSessions` 自动写回 title 的代码已删除
- [x] 原有逻辑（status / isSending / streamingMessageId / thinking / setTimeout / refetchSessions）保留
- [x] 文件头版本号改为 v2.6.0
- [x] sessions 本地 state 仍保留（用于 Sidebar 实时刷新），但不再在 onDone 中更新 title

## Task 7 — 前端 SessionListItem 派生计算
- [x] 派生计算 `displayTitle` 函数已实现（手动 title 优先 > 首条用户消息 > "新对话"）
- [x] 渲染处用 `displayTitle` 替代 `{session.title}`
- [x] 应用 Tailwind `truncate` 类实现单行省略号
- [x] 消息数徽章在 `message_count === 0` 时不显示
- [x] 文件头版本号改为 v1.1.0

## Task 8 — 文档与代码修改日志
- [x] 代码修改日志.md 追加"撤销 auto-session-title-generation"版本记录
- [x] 标注 auto-session-title-generation spec 为 SUPERSEDED

## Task 9 — 构建与回归
- [x] 后端 `python3 -c "from backend.app.main import app; print('OK')"` 启动无报错
- [x] 前端 `npm run build` 无编译错误
- [x] GUI 端到端：新 Session 显示"新对话"；发送首条消息后显示"首条消息+..."单行省略号；手动重命名后保留手动 title（SKIPPED — 需 GUI 环境；代码逻辑已验证）
- [x] grep 源码验证 `_generate_session_title` 不再被引用
- [x] grep 源码验证 SSE done payload 不再含 title 字段
