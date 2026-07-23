# Tasks
- [x] Task 1: 后端 - 修复 `StageStatus` 枚举值
  - [x] 1.1 `clarification_service.py`: 将 `'completed'` 改为 `'COMPLETED'`
- [x] Task 2: 前端 - 澄清完成时仍显示弹窗
  - [x] 2.1 `App.tsx`: 渲染条件改为 `questions.length > 0 || isComplete`
  - [x] 2.2 `handleClarifyQuestions`: 移除 `data.complete` 时关闭弹窗的逻辑，始终 `setShowClarifyModal(true)`
- [x] Task 3: 验证

# Task Dependencies
- Task 1 与 Task 2 可并行
