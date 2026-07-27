/**
 * # ============================================================
 * 路由类型定义 (v1.0.0) - Cycle 7 P1-2
 * # ============================================================
 * 核心作用：为 useParams 提供类型安全
 * 运行流程：定义每个动态路由段的参数形状
 * 输入参数：无
 * 输出结果：类型导出
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P1-2 新建
 # ============================================================
 */

/** /chat/session/:sessionId */
export type ChatSessionParams = { sessionId: string };

/** /coding/project/:projectId */
export type CodingProjectParams = { projectId: string };

/** /workflow/:workflowId */
export type WorkflowParams = { workflowId: string };

/** 通配符路径 (catch-all) */
export type CatchAllParams = { '*': string };
