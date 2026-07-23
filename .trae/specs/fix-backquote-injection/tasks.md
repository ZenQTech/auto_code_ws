# Tasks
- [x] Task 1: 在 `hermes_executor.py` 的 sanitization 中增加反引号和 `$` 转义
- [x] Task 2: 在 `hermes_service.py` 的 `_build_chat_command()`、`_build_optimize_command()`、`_build_plan_command()` 中增加转义
- [x] Task 3: 在 `prompt_optimizer.py` 和 `task_planner.py` 和 `validator.py` 中增加转义
- [x] Task 4: 在 `agent_roles/` 下所有 `execute(command=...)` 调用点增加转义
- [x] Task 5: 验证：构造含反引号/`$()` 的输入，确认不再报 EOF in backquote substitution

# Task Dependencies
- Task 2/3/4 均可与 Task 1 并行
- Task 5 依赖 Task 1-4
