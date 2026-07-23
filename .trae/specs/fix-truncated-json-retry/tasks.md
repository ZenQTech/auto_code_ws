# Tasks
- [x] Task 1: `_parse_clarify_response` 增加 JSON 截断修复逻辑
  - [x] 1.1 `_try_repair_truncated_json` 方法：4 种补全策略（`"]}]}`、`"]}`、`"]]}`、`}`）
  - [x] 1.2 修复后重新 `json.loads` 或 `raw_decode` 解析
- [x] Task 2: `clarify_round` 增加重试
  - [x] 2.1 `result.questions` 为空且非完成时，重试 LLM 调用一次
- [x] Task 3: 验证 - 截断 JSON 修复成功（questions=1）

# Task Dependencies
- Task 1 与 Task 2 可并行
