# Tasks

- [x] Task 1: 后端 Session 模型扩展
  - 1.1 在 `backend/app/models.py` 的 `Session` 模型新增 `title_auto_generated = Column(Boolean, default=False, nullable=False, comment="title 是否已由 AI 自动生成")`
  - 1.2 在 `SessionResponse` Pydantic 模型（`backend/app/api/sessions.py`）新增 `title_auto_generated: bool` 字段
  - 1.3 在 `Session.to_response` 转换函数中追加该字段

- [ ] Task 2: 数据库 schema 迁移
  - 2.1 在 `backend/app/database.py` 的 `_run_legacy_migration` 中追加：检查 `sessions.title_auto_generated` 列是否存在，若不存在则 `ALTER TABLE sessions ADD COLUMN title_auto_generated BOOLEAN DEFAULT 0`
  - 2.2 数据回填：执行 `UPDATE sessions SET title_auto_generated = 1 WHERE title != '新会话' AND title IS NOT NULL`（视为已被命名）
  - 2.3 迁移失败 try/except 不阻塞启动

- [ ] Task 3: Hermes 服务层 - 自动命名方法
  - 3.1 在 `backend/app/services/hermes_service.py` 新增私有方法 `_generate_session_title(user_msg: str, assistant_msg: str) -> str`
  - 3.2 方法内部组装 prompt：`"请用 6-16 个中文字符总结以下对话的主题，作为侧边栏对话标题。要求：纯文本、不要引号、不要 markdown、不要解释。\n用户：{user_msg[:200]}\n助手：{assistant_msg[:300]}"`
  - 3.3 调用 `self.executor.execute('hermes', ['chat', '-q', prompt, '-Q'])`（或现有 CLIExecutor 接口）执行 LLM 调用
  - 3.4 解析输出：取第一非空行 → strip → 去除首尾成对引号（`'"/「」""''`）
  - 3.5 长度校验：> 16 字截断；< 4 字或为空时抛 ValueError
  - 3.6 失败兜底：捕获异常时 fallback 到"截取首条用户消息前 30 字"（与 conversation-history-sidebar 默认行为一致）

- [ ] Task 4: 后端 Sessions API - auto-title 端点
  - 4.1 在 `backend/app/api/sessions.py` 新增 Pydantic 模型 `AutoTitleRequest`：`{"user_message": str, "assistant_message": str}`
  - 4.2 在 `backend/app/api/sessions.py` 新增 Pydantic 模型 `AutoTitleResponse`：`{"title": str, "session_id": str}`
  - 4.3 新增端点 `POST /api/sessions/{id}/auto-title`：
    - 校验 Session 存在（不存在 404）
    - 校验 user_message / assistant_message 非空（任一为空 400）
    - 调用 `HermesService._generate_session_title(user_msg, assistant_msg)` 拿新 title
    - PATCH Session.title = 新 title + title_auto_generated = True
    - 返回 `AutoTitleResponse`
  - 4.4 端点带 `logger.info` 关键操作日志

- [ ] Task 5: 后端 SSE - 流式响应携带 title
  - 5.1 在 `backend/app/api/hermes.py` 的 `chat_with_hermes_streaming` 端点中，在 Hermes 流式 done 时：
    - 检查 `Session.title_auto_generated` 为 False 且 `title == '新会话'`
    - 若满足，调 `_generate_session_title(user_msg, assistant_msg)`
    - 把 title 塞到 `done` 事件的 SSE data 中（`{"type": "done", "title": "..."}`）
  - 5.2 失败兜底：title 生成失败时 done 事件不携带 title，前端静默忽略
  - 5.3 同步 PATCH Session.title 落库（即使前端不调 auto-title 端点，title 也会持久化）

- [x] Task 6: 前端 SSE 解析 - onDone 接收 title
  - 6.1 在 `frontend/src/hooks/useApi.ts` 的 `chatWithHermesStreaming` 中扩展 done 事件处理：
    - 现有 `case 'done': onDone?.(); return;` 改为 `case 'done': onDone?.(event.title); return;`
  - 6.2 `chatWithHermes` 函数签名不变（同步响应已包含 session_title 字段，但 onDone 不需要）

- [x] Task 7: 前端 App.tsx - 自动写回 title
  - 7.1 修改 `App.tsx` 中 `handleSendMessage` 流式调用处的 `onDone` 回调：
    - 原：`onDone: () => { ... }`
    - 新：`onDone: async (title?: string) => { ... 原有逻辑 ... ; if (title && currentSessionId) { await updateSession(currentSessionId, { title }); setSessions(prev => prev.map(s => s.id === currentSessionId ? { ...s, title } : s)); } }`
  - 7.2 Sidebar 接收 `sessions` prop 时使用最新 title（已经通过 sessions state 自动响应）

- [x] Task 8: 构建与回归验证
  - 8.1 后端 `python3 -c "from backend.app.main import app; print('OK')"` 启动无报错
  - 8.2 前端 `npm run build` 无编译错误
  - 8.3 端到端（GUI）：用户首次发消息 → onDone 后 1-3 秒内看到侧边栏标题变化为 6-16 字中文
  - 8.4 端到端（GUI）：用户在同一 Session 发第二条消息 → 标题不变化
  - 8.5 端到端（GUI）：AI 总结失败时 → 标题保持"新会话"占位，不影响对话

# Task Dependencies
- Task 1（模型扩展）是所有后端任务的前置
- Task 2（迁移）依赖 Task 1
- Task 3（Hermes 方法）独立，可在 Task 1 后并行
- Task 4（API 端点）依赖 Task 1 + Task 3
- Task 5（SSE 携带 title）依赖 Task 3
- Task 6（前端 SSE 解析）独立
- Task 7（App 写回）依赖 Task 6 + Task 4 后端 API
- Task 8（验证）依赖 Task 1-7 全部完成
