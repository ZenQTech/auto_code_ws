/**
 * # ============================================================
 * # Hermes 智能调度 API 模块（useHermesApi）
 * # ============================================================
 * # 核心作用：从 useApi 重新导出所有 Hermes 智能体对话/流式/优化/
 * #          计划确认相关的 API，按业务域拆分以提升代码可维护性。
 * # 运行流程：
 * #   1. 调用方从本文件 import Hermes 相关 API
 * #   2. 实际请求逻辑由 useApi.ts 中的实现承担
 * #   3. 保持 100% 向后兼容，仅做模块路径重定向
 * # ============================================================
 * # 端点契约（详见 useApi.ts）：
 * #   - POST /api/hermes/chat          非流式对话
 * #   - POST /api/hermes/chat/stream   SSE 流式对话（含 thinking / text /
 * #                                    clarify_questions / workflow_started /
 * #                                    review_result / pipeline_step /
 * #                                    goal_update / done / error 事件）
 * #   - POST /api/hermes/optimize      提示词优化 + 任务规划
 * #   - POST /api/hermes/confirm       确认执行计划
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-24 | v1.0.0 | 初版 re-export 文件，从 useApi.ts 重导出
 * #     Hermes 智能调度相关 API（chatWithHermes / chatWithHermesStreaming /
 * #     optimizeWithHermes / confirmPlan）
 * # ============================================================
 */

export {
  chatWithHermes,
  chatWithHermesStreaming,
  optimizeWithHermes,
  confirmPlan,
} from './useApi';
