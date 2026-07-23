# Tasks

- [x] Task 1: 修复 ClarificationModal 渲染条件
  - 在 `App.tsx` 第 1362 行和第 1628 行，将 `clarificationData.questions.length > 0 || clarificationData.isComplete` 改为 `clarificationData.questions.length > 0 || clarificationData.isComplete || clarificationData.roundNumber >= 3`
  - **验证**：round=4, questions=0, isComplete=false 时模态弹窗正常显示

# Task Dependencies
- 无依赖，单文件两处相同修改
