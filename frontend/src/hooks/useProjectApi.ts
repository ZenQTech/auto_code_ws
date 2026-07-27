/**
 * # ============================================================
 * # 项目 / 文件 / 配置 API 模块（useProjectApi）
 * # ============================================================
 * # 核心作用：从 useApi 重新导出所有"项目 / 工作区文件 / 全局配置"
 * #          相关的 API，按业务域拆分以提升代码可维护性。
 * # 运行流程：
 * #   1. 调用方从本文件 import 项目/文件/配置相关 API 与类型
 * #   2. 实际请求逻辑由 useApi.ts 中的实现承担
 * #   3. 保持 100% 向后兼容，仅做模块路径重定向
 * # ============================================================
 * # 端点契约（详见 useApi.ts）：
 * #   - GET    /api/workspace/projects                       获取项目列表
 * #   - POST   /api/workspace/projects                       创建新项目
 * #   - GET    /api/workspace/tree?project=xxx               获取文件树
 * #   - GET    /api/workspace/file?project=xxx&path=xxx      获取文件内容
 * #   - DELETE /api/workspace/file?...                       删除文件
 * #   - POST   /api/workspace/file/copy?...                  复制文件
 * #   - POST   /api/workspace/file/rename?...                重命名文件
 * #   - GET    /api/config/sections                          全局配置分组
 * #   - GET    /api/config                                   读取完整配置
 * #   - PUT    /api/config                                   部分更新配置
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-24 | v1.0.0 | 初版 re-export 文件，从 useApi.ts 重导出
 * #     项目/文件/配置相关 API（fetchProjects / createProject /
 * #     fetchFileTree / fetchFileContent / deleteFile / copyFile /
 * #     renameFile / useConfigSections / fetchConfig / updateConfig）
 * #     及 FullConfig 类型
 * #   - 2026-07-24 | v1.1.0 | 导出 DiffView 相关 API：fetchDiffFiles / checkoutFile
 * #     及配套类型（FileDiffResponse / DiffFilesResponse / CheckoutFileResponse），
 * #     支撑 Module D DiffView 组件
 * # ============================================================
 */

export {
  // 项目工作区 API
  fetchProjects,
  createProject,
  // 文件资源管理器 API
  fetchFileTree,
  fetchFileContent,
  deleteFile,
  copyFile,
  renameFile,
  // 全局配置中心 API
  useConfigSections,
  fetchConfig,
  updateConfig,
  // DiffView API（v1.1.0 新增 - Module D）
  fetchDiffFiles,
  checkoutFile,
  // 配套类型导出
  type FullConfig,
  type FileDiffResponse,
  type DiffFilesResponse,
  type CheckoutFileResponse,
} from './useApi';
