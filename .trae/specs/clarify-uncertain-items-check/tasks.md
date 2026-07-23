# Tasks
- [x] Task 1: `clarification_service.py` - `handle_user_response` 增加不确定项检测
  - [x] 1.1 检测 `requirement_doc` 中是否包含"不确定项"或"待确认项"关键词
  - [x] 1.2 若存在 → `clarification_complete = False`（覆盖 AI 判断）
  - [x] 1.3 轮次 ≥ 6 时追加"是否继续澄清"提示
  - [x] 1.4 轮次 ≥ 13 时强制 `clarification_complete = True`
- [x] Task 2: `requirement_clarifier.py` - 提示词优化（逻辑已由 clarification_service 覆盖）
- [x] Task 3: 前端 - `ClarificationCard` 增加"跳过进入架构设计"按钮
  - [x] 3.1 `roundNumber ≥ 6` 时显示"跳过不确定项，进入架构设计"按钮

# Task Dependencies
- Task 2 依赖 Task 1
- Task 3 可与 Task 1-2 并行
