/**
 * # ============================================================
 * API 请求钩子 - 统一 barrel re-export 入口
 * # ============================================================
 * 核心作用：保留原 useApi.ts 全部公开 API，但将实现拆分到 5 个分类模块
 * 拆分日期：2026-07-27
 * 来源文件：hooks/useApi.ts (v3.0.0, 1872 行单文件)
 * 模块版本：v6.5.0 - P0-3 useApi.ts 拆分第一阶段
 * 修改记录：
 *   - 2026-07-27 | v6.5.0 | 拆分为 useAgentsApi / useTasksApi / useWorkflowApi /
 *     useSessionsApi / useSystemApi + apiShared 5 个子模块，本文件仅保留
 *     re-export 以维持向后兼容
 *
 * 拆分原因：
 *   - useApi.ts 在 v3.0.0 已增至 1872 行，单文件维护成本高
 *   - 89 个 export 散落在单一文件，依赖关系与变更影响面难以追踪
 *   - 拆分为 5 个分类模块（agent/task/workflow/session/system）后，
 *     单文件不超过 1000 行，每个模块职责清晰、依赖明确
 *
 * 兼容性保证：
 *   - 100% 保持所有 export 名称不变
 *   - 100% 保持所有 export 签名不变
 *   - 100% 保持所有 import 路径 '../hooks/useApi' 仍可工作
 * ============================================================
 */

// 智能体 API
export * from './useAgentsApi';
// 任务 API
export * from './useTasksApi';
// 工作流 API（架构设计 / Hermes 对话 / 优化 / 确认）
export * from './useWorkflowApi';
// 会话 API（WebSocket + 会话 CRUD + 回收站）
export * from './useSessionsApi';
// 系统 API（配额 / 架构 / Git / Memory / 模型选择 / 评估）
export * from './useSystemApi';
