# Checklist

## 首轮澄清问题推送
- [x] `start_workflow` 调用 `clarification_service.start_clarification()`
- [x] ClarificationService._states 中有该 workflow 的 state（多轮可延续）
- [x] 首轮 ClarifyResult 暴露给 hermes_service（workflow._clarify_result）
- [x] 工作流成功路径 yield `clarify_questions` 事件（含 options）
- [x] SSE 顺序：text → workflow_started → clarify_questions → done
- [x] 前端 ClarificationCard 首轮即渲染为选项卡片（端到端事件验证通过）

## 异常不 fall-through
- [x] start_workflow 异常分支末尾有 `return`
- [x] 失败时不进入普通对话/LLM 自由回复

## 消除 SSE 主动中止
- [x] `useApi.ts` done 分支无 `reader.cancel()`
- [x] `useApi.ts` error 分支无 `reader.cancel()`
- [x] AbortError（用户停止）仍被识别静默
- [x] 正常对话完成不再产生 `net::ERR_ABORTED`

## 验证
- [x] 后端 Python 语法编译通过
- [x] 端到端验证首轮 clarify_questions 推送
- [x] 前端诊断无错误
- [x] 无临时文件
