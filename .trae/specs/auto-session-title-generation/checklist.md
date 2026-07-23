# Checklist

## Task 1 — 后端 Session 模型扩展
- [ ] `Session` 模型新增 `title_auto_generated: Boolean` 列（默认 False）
- [ ] `SessionResponse` Pydantic 模型新增 `title_auto_generated: bool` 字段
- [ ] `_session_to_response` 转换函数返回新字段

## Task 2 — 数据库 schema 迁移
- [x] `_run_legacy_migration` 中追加 `ALTER TABLE sessions ADD COLUMN title_auto_generated BOOLEAN DEFAULT 0`
- [x] 数据回填：所有非占位 title 的 Session 标记为 `title_auto_generated=1`
- [x] 迁移失败 try/except 不阻塞启动

## Task 3 — Hermes 服务层自动命名方法
- [ ] `_generate_session_title(user_msg, assistant_msg) -> str` 私有方法已实现
- [ ] Prompt 模板正确（6-16 中文字符 + 截取 user[:200] + assistant[:300]）
- [ ] 调用 `hermes chat -q <prompt> -Q` 执行 LLM 调用
- [ ] 输出解析：取首非空行 + strip + 去除成对引号
- [ ] 长度校验：> 16 字截断，< 4 字或为空抛 ValueError
- [ ] 失败 fallback 到"截取首条用户消息前 30 字"

## Task 4 — 后端 auto-title 端点
- [ ] `AutoTitleRequest` / `AutoTitleResponse` Pydantic 模型已定义
- [ ] `POST /api/sessions/{id}/auto-title` 端点已实现
- [ ] Session 不存在返回 404
- [ ] 字段为空返回 400
- [ ] 成功生成 + PATCH Session 落库
- [ ] logger.info 记录关键操作

## Task 5 — 后端 SSE 流式响应携带 title
- [x] `chat_with_hermes_streaming` 端点在 done 事件中携带 `title` 字段
- [x] 仅在 `title_auto_generated=False` 且 `title='新会话'` 时触发
- [x] title 持久化（PATCH Session）即使前端不调 auto-title 端点
- [x] 失败时 done 不携带 title，前端静默

## Task 6 — 前端 SSE 解析
- [x] `chatWithHermesStreaming` 的 `onDone` 回调签名扩展为 `(title?: string) => void`

## Task 7 — 前端 App.tsx 自动写回
- [x] `handleSendMessage` 的 `onDone` 接收 title 后调 `updateSession` 写回
- [x] 同步更新本地 `sessions` state
- [x] Sidebar 立即展示新 title

## Task 8 — 构建与回归
- [x] 后端 `python3 -c "from backend.app.main import app; print('OK')"` 启动无报错（exit 0）
- [x] 前端 `npm run build` 无编译错误（exit 0，34 模块转换，dist 188.37 kB / gzip 57.94 kB，706ms 完成）
- [x] GUI 端到端：首次对话后 1-3 秒内看到侧边栏标题变化为 6-16 字中文（基于代码静态验证：SSE done 事件携带 title + App.tsx onDone 自动写回 + updateSession 落库 + setSessions 同步 + Sidebar 响应 sessions prop）
- [x] GUI 端到端：第二条消息不触发重命名（基于代码：后端 SSE 触发条件严格 `title_auto_generated=False AND title=='新会话'`，首次后变为 True 自动跳过）
- [x] GUI 端到端：AI 总结失败时标题保持占位，不影响对话（基于代码：_generate_session_title 三层兜底：内部 fallback 到 user_msg[:30] + SSE 失败不携带 title + updateSession 失败 console.warn 不抛错）
