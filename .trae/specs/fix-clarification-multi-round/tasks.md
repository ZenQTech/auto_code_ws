# Tasks
- [x] Task 1: 后端 - `ClarifyResult` 新增 `round_number`/`max_rounds` 字段，`ClarificationService` 填充，`_format_clarify_result_for_sse` 透传到 SSE 事件
  - [x] 1.1 `requirement_clarifier.py`: `ClarifyResult` dataclass 新增 `round_number: int = 0` 和 `max_rounds: int = 5`
  - [x] 1.2 `clarification_service.py`: `start_clarification()` 和 `handle_user_response()` 中设置 `result.round_number` 和 `result.max_rounds`
  - [x] 1.3 `hermes_service.py`: `_format_clarify_result_for_sse()` 在 `clarify_questions` 事件中新增 `round` 和 `maxRounds` 字段
- [x] Task 2: 前端 - `handleClarifyQuestions` 消费 `round`/`maxRounds` 字段
  - [x] 2.1 `App.tsx`: 代码已正确使用 `data.round` 和 `data.maxRounds`，无需修改
- [x] Task 3: 前端 - `ClarificationCard` 防御性重置 `submitted` 状态
  - [x] 3.1 `ClarificationCard.tsx`: 新增 `useEffect` 监听 `roundNumber`，变化时重置 `submitted` 和 `selections`/`otherInputs`
- [x] Task 4: **v2.7.0 CRITICAL** - `hermes_service.py` 开发需求检测覆盖澄清模式检测
  - [x] 4.1 将 clarifying 模式检查前置到开发需求检测（`_is_development_request`）之前
  - [x] 4.2 开发需求检测增加 `not is_clarifying_mode` 守卫
  - [x] 4.3 移除下方冗余的二次 clarifying 模式数据库查询
- [x] Task 5: **v2.7.0** - `useApi.ts` 修复 `maxRounds` 字段名不匹配（`max_rounds` → `maxRounds`）
- [x] Task 6: **v2.0.0** - `ThinkingBlock.tsx` 视觉升级对齐 Trae IDE solo 模式
  - [x] 6.1 左侧紫色渐变边框
  - [x] 6.2 图标圆形背景容器
  - [x] 6.3 思考中自动展开
  - [x] 6.4 展开内容区紫色主题配色

# Task Dependencies
- Task 4 是本次修复的 CRITICAL 根因
- Task 2 依赖 Task 1（前端消费后端新字段）
- Task 5、Task 6 独立
