/**
 * # ============================================================
 * # 极简顶部品牌栏组件 - BrandHeader
 * # ============================================================
 * # 核心作用：替代原 App.tsx 顶部复杂布局，遵循豆包式极简风格，
 * #           把次要操作（设置 / 回收站 / 用量）移到三个点下拉菜单，
 * #           顶部只保留 Logo + Session 标题 + 新建对话按钮。
 * # 运行流程：
 * #   1. 左侧：Logo（圆形渐变背景 + 闪电图标，Hermes 主色调）
 * #   2. 中间：Session 标题（仅 md+ 显示，移动端隐藏）
 * #   3. 右侧：新建对话按钮（圆形，hover 旋转 90°）+ 三个点下拉菜单
 * #   4. 点击外部区域关闭下拉菜单（通过 useEffect 绑定 document mousedown）
 * #   5. 菜单项点击后触发对应 onOpen* 回调，同时关闭菜单
 * # 输入参数：
 * #   - sessionTitle: 当前 Session 标题（中间显示）
 * #   - onNewChat: 新建对话回调
 * #   - onOpenSettings?: 打开设置面板回调（可选）
 * #   - onOpenTrash?: 打开回收站回调（可选）
 * #   - onOpenUsage?: 打开/切换用量监控回调（可选）
 * # 输出结果：56px 高极简顶部品牌栏（sticky 吸顶 + 半透明背景 + 底部细边）
 * # 复用说明：
 * #   - 无复用（全新组件）
 * #   - lucide-react 未安装，下拉菜单图标使用 inline SVG
 * # 修改记录：
 * #   - 2026-06-24 | v1.0.0 | 初始版本：极简顶部 + 半透明背景 + 下拉菜单（豆包风格）
 * #   - 2026-06-24 | v1.1.0 | 新增 appMode prop + 模式指示器 pill（聊天 / 编程双模式标识）
 * #   - 2026-06-24 | v1.1.0 | 下拉菜单新增"文件浏览器"切换项（控制 fileExplorerOpen state）
 * #   - 2026-06-24 | v1.2.0 | 渲染模式切换 pill（解决 BrandHeader appMode prop 未渲染问题）
 * #   - 2026-06-24 | v1.3.0 | 删除模式切换 pill（信息密度过高；保留 Sidebar/ProjectSelector 入口）
 * #   - 2026-07-24 | v1.4.0 | 新增 onOpenLoopV7 回调 + 菜单项"Loop v7 工作流"，提供端到端 15 步工作流启动入口
#   - 2026-07-24 | v1.5.0 | 新增 newChatLoading 可选 prop：新建对话按钮显示加载态
#     防止快速重复点击触发多次 handleNewTask，避免并发创建多个空 Session
#   - 2026-07-27 | v1.6.0 | Cycle 2 新增：菜单项 MCP 工具 / 会话压缩 / 技能管理 / AGENTS.md 记忆
#     提供 onOpenMCP / onOpenCompaction / onOpenSkills / onOpenAgentsMd 回调
#   - 2026-07-27 | v1.7.0 | Cycle 3 新增：菜单项 MCP 高级功能 / 双触发压缩 / 多类型规则扫描
#     新增 onOpenCycle3 / onOpenDualCompaction / onOpenRules 回调
#     新增 shield (盾牌) + cpu (CPU) 内联 SVG 图标
#     新增"Cycle 3 新功能"分组（带顶部分割线）
#   - 2026-07-27 | v2.8.0 | Cycle 7 P0-10 新增：菜单项 Multi-Agent v2 Path Tree
#     新增 onOpenMultiAgentTree 回调 + tree（树状）图标
#     对应 Codex v0.121+ path-based addressing + TRAE "对话流节点自动折叠"
#   - 2026-07-30 | v2.9.0 | Cycle 25 新增：菜单项 自动化代码评审 / PR 自动机器人 / AI 性能优化器
#     新增 onOpenAutoCodeReview / onOpenPRBot / onOpenPerfOptimizer 回调
#     新增 search-check (代码评审) / bot (机器人) / gauge (性能计) 内联 SVG 图标
#     对应 Codex PR review + TRAE 实时代码质量分析 + AI 主动性能建议
#   - 2026-07-30 | v2.10.0 | Cycle 26 新增：菜单项 CSV 批处理 / 智能审批 / MTC 多模任务
#     新增 onOpenCsvBatch / onOpenSmartApproval / onOpenMTC 回调
#     新增 csv / shield-alert / palette 内联 SVG 图标
#   - 2026-07-30 | v2.12.0 | Cycle 30 新增：菜单项 成本阈值告警 / 动态工作流 / 编排多代理
#     新增 onOpenCostThreshold / onOpenDynamicWorkflow / onOpenOrchestratedAgent 回调
#     对应 Claude Code Admin Console 75%/90%/100% 阈值告警 + Codex Dynamic Workflows + Codex Orchestrated Mode
#   - 2026-07-30 | v2.13.0 | Cycle 31 新增：菜单项 成本归因 / 远程 Worktree / Worktree 状态同步
#     新增 onOpenCostAttribution / onOpenRemoteWorktree / onOpenWorktreeSync 回调
#     新增 attribution (饼图) / cloud (云) / sync (双向箭头) 内联 SVG 图标
#     对应 Cursor Per-Repository Cost Attribution + Cursor 3 Cloud Agent Handoff + CodexMonitor 多设备同步
#   - 2026-07-30 | v2.14.0 | Cycle 32 新增：菜单项 审计追踪 / 单点登录 / 策略规则
#     新增 onOpenAuditTrail / onOpenSSO / onOpenPolicy 回调
#     新增 audit (盾牌 + 勾) / sso (钥匙) / policy (文档) 内联 SVG 图标
#     对应 SOC 2 / GDPR / EU AI Act 审计 + OIDC/SAML/SCIM 单点登录 + OPA/Rego 策略引擎
#   - 2026-07-30 | v2.15.0 | Cycle 33 新增：菜单项 企业工作流 / 集成 Dashboard / 安全审计
#     新增 onOpenEnterpriseWorkflow / onOpenUnifiedDashboard / onOpenSecurityAudit 回调
#     新增 workflow (齿轮) / dashboard (仪表盘) / shield (盾牌) 内联 SVG 图标
#     对应企业级工作流编排 + 30+ 引擎统一 Dashboard + 7 个预置攻击场景自动化
#   - 2026-07-31 | v2.16.0 | Cycle 34 新增：菜单项 端云模型路由 / 离线优先 / 设备集群
#     新增 onOpenEdgeModelRouter / onOpenOfflineFirst / onOpenDeviceCluster 回调
#     新增 edge-cloud (云+端) / offline (云断线) / devices (多设备) 内联 SVG 图标
#     对应 Cursor Router 端云路由 + Trae Solo 离线优先 + mDNS/DNS-SD 设备发现
#   - 2026-07-31 | v2.18.0 | Cycle 36 G36-01/02/03 新增：菜单项 LLM Provider / 流式对话 / 多模态
#     新增 onOpenLLMProvider / onOpenStreamingChat / onOpenMultiModal 回调
#     对应 Anthropic/OpenAI/Ollama 适配 + SSE 流式响应 + 图像/音频/文件处理
#   - 2026-07-31 | v2.19.0 | Cycle 37 G37-01/02/03/04 新增：菜单项 RAG 知识库 / 工具市场 / Agent Loop / 真实 LLM
#     新增 onOpenRAG / onOpenToolMarketplace / onOpenAgentLoop / onOpenRealLLMProvider 回调
#     新增 rag (书本+齿轮) / tool (扳手) / loop (循环箭头) / real-llm (云+勾选) 内联 SVG 图标
#     对应 RAG 引擎+工具市场+ReAct/Plan-Execute Agent Loop+DeepSeek/火山方舟真实 LLM 集成
#   - 2026-07-31 | v2.20.0 | Cycle 38 G38-01/02/03/04 新增：菜单项 多 Agent 协作 / 长期记忆 / 反思迭代 / 审批中心
#     新增 onOpenMultiAgentCrew / onOpenLongTermMemory / onOpenReflection / onOpenHumanApproval 回调
#     新增 multi-agent (三节点网络) / memory (数据库+时钟) / reflection (镜像+箭头) / approval (盾牌+勾) 内联 SVG 图标
#     对应 Manager-Worker 多 Agent 协作 + MemGPT 风格分层记忆 + Reflexion 反思引擎 + 人机审批流
#   - 2026-07-31 | v2.21.0 | Cycle 41 G41-01/02/03/04 新增：菜单项 MCP 高级能力
#     新增 onOpenMcpAdvanced 回调
#     对应 MCP 资源订阅 + 参数补全 + 服务器采样 + 根目录管理 4 大高级能力
# ============================================================
 */

import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * BrandHeader 组件 Props
 */
export interface BrandHeaderProps {
  /** 当前 Session 标题，用于中间区域展示 */
  sessionTitle: string;
  /** 新建对话按钮点击回调 */
  onNewChat: () => void;
  /** v1.5.0 新增：新建对话按钮是否处于加载态（true 时禁用按钮 + 显示旋转图标） */
  newChatLoading?: boolean;
  /** 打开设置面板回调（可选，提供则菜单显示"设置"项） */
  onOpenSettings?: () => void;
  /** 打开回收站回调（可选，提供则菜单显示"回收站"项） */
  onOpenTrash?: () => void;
  /** 打开/切换用量监控回调（可选，提供则菜单显示"用量监控"项） */
  onOpenUsage?: () => void;
  /** v1.1.0 新增：切换文件浏览器显示/隐藏回调（可选，提供则菜单显示"文件浏览器"项） */
  onOpenFileExplorer?: () => void;
  /** v1.1.0 新增：当前文件浏览器显示状态（用于菜单项右侧状态指示） */
  fileExplorerOpen?: boolean;
  /** v1.4.0 新增：打开 Loop v7 工作流弹窗回调（可选，提供则菜单显示"Loop v7 工作流"项） */
  onOpenLoopV7?: () => void;
  /** v2.0.0 (Cycle 9 P1-7) 新增：打开 DiffView 增强页路由回调 */
  onOpenDiffView?: () => void;
  /** v1.0.0 (Cycle 10 P1-8) 新增：打开 Memory System 路由回调 */
  onOpenMemory?: () => void;
  /** v1.0.0 (Cycle 10 P1-10) 新增：Verification Loop 入口回调 */
  onOpenVerification?: () => void;
  /** v1.0.0 (Cycle 11 P2-2) 新增：Doctor 环境诊断入口回调 */
  onOpenDoctor?: () => void;
  /** v1.0.0 (Cycle 13 P1-2) 新增：LLM-as-Judge 验证层入口回调 */
  onOpenLlmJudge?: () => void;
  /** v1.0.0 (Cycle 13 P1-3) 新增：Plugin Marketplace 入口回调 */
  onOpenMarketplace?: () => void;
  /** v1.0.0 (Cycle 14 P0-2) 新增：多模态支持入口回调 */
  onOpenMultimodal?: () => void;
  /** v1.0.0 (Cycle 14 P0-3) 新增：企业级 Plugin Hub 入口回调 */
  onOpenEnterpriseHub?: () => void;
  /** v1.0.0 (Cycle 14 P1-3) 新增：TRAE Work 多模态协作入口回调 */
  onOpenTraeWork?: () => void;
  /** v1.0.0 (Cycle 14 P1-4) 新增：Goal Automation 入口回调（独立路由 /goal-automation） */
  onOpenGoalAutomation?: () => void;
  /** v1.0.0 (Cycle 14 P1-5) 新增：Goal Templates 模板库入口回调（独立路由 /goal-templates） */
  onOpenGoalTemplates?: () => void;
  /** v1.6.0 新增：打开 MCP 工具面板回调（可选，提供则菜单显示"MCP 工具"项） */
  onOpenMCP?: () => void;
  /** v1.6.0 新增：打开会话压缩面板回调（可选，提供则菜单显示"会话压缩"项） */
  onOpenCompaction?: () => void;
  /** v1.6.0 新增：打开技能管理面板回调（可选，提供则菜单显示"技能管理"项） */
  onOpenSkills?: () => void;
  /** v1.6.0 新增：打开 AGENTS.md 记忆管理回调（可选，提供则菜单显示"AGENTS.md 记忆"项） */
  onOpenAgentsMd?: () => void;
  /** Cycle 3 v1.0.0 新增：打开 Cycle 3 MCP 高级功能面板回调（可选） */
  onOpenCycle3?: () => void;
  /** Cycle 3 v1.0.0 新增：打开双触发压缩面板回调（可选） */
  onOpenDualCompaction?: () => void;
  /** Cycle 3 v1.0.0 新增：打开多类型规则扫描面板回调（可选） */
  onOpenRules?: () => void;
  /** v2.0.0 (Cycle 4 P0-3) 新增：打开 Plan 编辑器面板回调（可选） */
  onOpenPlanEditor?: () => void;
  /** v2.1.0 (Cycle 4 P0-4) 新增：打开 Hooks 事件系统面板回调（可选） */
  onOpenHooks?: () => void;
  /** v2.2.0 (Cycle 4 P0-4) 新增：打开 SubAgent 记忆查看器回调（可选） */
  onOpenSubagentMemory?: () => void;
  /** v2.3.0 (Cycle 5 P0-6) 新增：打开 Hook 触发链路查看器回调（可选） */
  onOpenHookChain?: () => void;
  /** v2.4.0 (Cycle 6 P0-7-A) 新增：打开 LLM 缓存统计面板回调（可选） */
  onOpenCacheStats?: () => void;
  /** v2.5.0 (Cycle 6 P0-7-B) 新增：打开流式恢复网关面板回调（可选） */
  onOpenStreamList?: () => void;
  /** v2.6.0 (Cycle 7 P0-8) 新增：打开 OAuth 2.1 + PKCE 配置面板回调（可选） */
  onOpenOAuthConfig?: () => void;
  /** v2.7.0 (Cycle 7 P0-9) 新增：打开 Session Rollout JSONL 持久化面板回调（可选） */
  onOpenSessionRollout?: () => void;
  /** v2.8.0 (Cycle 7 P0-10) 新增：打开 Multi-Agent v2 Path Tree 面板回调（可选） */
  onOpenMultiAgentTree?: () => void;
  /** v2.9.0 (Cycle 7 P0-11) 新增：打开 TRACE 规则管理面板回调（可选） */
  onOpenTraceRule?: () => void;
  /** v2.10.0 (Cycle 8 P0-12) 新增：打开 Slash Commands 帮助面板回调（可选） */
  onOpenSlashCommand?: () => void;
  /** v2.11.0 (Cycle 8 P0-14) 新增：打开 Custom Models 管理面板回调（可选） */
  onOpenCustomModels?: () => void;
  /** v2.12.0 (Cycle 39 G39-03) 新增：打开 MCP 服务器注册表面板回调（可选） */
  onOpenMcpRegistry?: () => void;
  /** v2.21.0 (Cycle 41) 新增：打开 MCP 高级能力面板回调（可选） */
  onOpenMcpAdvanced?: () => void;
  /** v6.36.0 (Cycle 16 P0-1) 新增：打开 Composer 多文件编辑面板回调（可选） */
  onOpenComposer?: () => void;
  /** v6.41.0 (Cycle 19 P0-1) 新增：打开后台任务面板回调（可选） */
  onOpenBackgroundTasks?: () => void;
  /** v6.42.0 (Cycle 19 P0-2) 新增：打开 Best-of-N 多模型对比面板回调（可选） */
  onOpenBestOfN?: () => void;
  /** v6.43.0 (Cycle 19 P0-3) 新增：打开 Design Mode 设计模式覆盖层回调（可选） */
  onOpenDesignMode?: () => void;
  /** v6.45.0 (Cycle 20 P0-1) 新增：打开 Worktree 隔离管理面板回调（可选） */
  onOpenWorktree?: () => void;
  /** v6.46.0 (Cycle 20 P0-2) 新增：打开智能模型路由面板回调（可选） */
  onOpenModelRouter?: () => void;
  /** v6.47.0 (Cycle 20 P0-3) 新增：打开事件钩子管理面板回调（可选） */
  onOpenHooks20?: () => void;
  /** v6.48.0 (Cycle 21 P0-1) 新增：打开 Best-of-N × Worktree 协同面板回调（可选） */
  onOpenBestOfNCoordinator?: () => void;
  /** v6.49.0 (Cycle 21 P0-2) 新增：打开模型路由成本统计 Dashboard 回调（可选） */
  onOpenModelRouterStats?: () => void;
  /** v6.50.0 (Cycle 21 P0-4) 新增：打开 Hook 模板市场面板回调（可选） */
  onOpenHooksMarketplace?: () => void;
  /** v6.51.0 (Cycle 22 G22-01) 新增：打开 Side Chat 多子对话面板回调（可选） */
  onOpenSideChat?: () => void;
  /** v6.52.0 (Cycle 22 G22-02) 新增：打开成本预测面板回调（可选） */
  onOpenCostPrediction?: () => void;
  /** v6.53.0 (Cycle 22 G22-03) 新增：打开 Hook 性能分析面板回调（可选） */
  onOpenHookPerformance?: () => void;
  /** v6.54.0 (Cycle 22 G22-04) 新增：打开模型路由管理面板回调（可选） */
  onOpenModelRouterAdmin?: () => void;
  /** v6.55.0 (Cycle 23 G23-01) 新增：候选学习面板回调（可选） */
  onOpenCandidateLearning?: () => void;
  /** v6.56.0 (Cycle 23 G23-02) 新增：会话回放面板回调（可选） */
  onOpenSessionReplay?: () => void;
  /** v6.57.0 (Cycle 23 G23-04) 新增：AI 主动建议面板回调（可选） */
  onOpenProactiveSuggestion?: () => void;
  /** v6.58.0 (Cycle 24 G24-01) 新增：全局记忆面板回调（可选） */
  onOpenGlobalMemory?: () => void;
  /** v6.59.0 (Cycle 24 G24-02) 新增：多任务并行编排面板回调（可选） */
  onOpenMultiTask?: () => void;
  /** v6.60.0 (Cycle 24 G24-04) 新增：Figma 设计稿转代码 */
  onOpenFigmaImport?: () => void;
  /** v6.61.0 (Cycle 25 G25-01) 新增：自动化代码评审 */
  onOpenAutoCodeReview?: () => void;
  /** v6.62.0 (Cycle 25 G25-02) 新增：PR 自动机器人 */
  onOpenPRBot?: () => void;
  /** v6.63.0 (Cycle 25 G25-03) 新增：AI 性能优化器 */
  onOpenPerfOptimizer?: () => void;
  /** v6.64.0 (Cycle 26 G26-01) 新增：CSV 批处理智能体 */
  onOpenCsvBatch?: () => void;
  /** v6.65.0 (Cycle 26 G26-02) 新增：智能审批引擎 */
  onOpenSmartApproval?: () => void;
  /** v6.66.0 (Cycle 26 G26-03) 新增：MTC 多模任务协作 */
  onOpenMTC?: () => void;
  /** v6.67.0 (Cycle 27 G27-01) 新增：嵌套子代理 */
  onOpenNestedSubAgent?: () => void;
  /** v6.68.0 (Cycle 27 G27-02) 新增：代理检查点 */
  onOpenAgentCheckpoint?: () => void;
  /** v6.69.0 (Cycle 27 G27-04) 新增：代理消息 */
  onOpenAgentMessaging?: () => void;
  /** v6.70.0 (Cycle 27 G27-05) 新增：代理模板 */
  onOpenAgentTemplate?: () => void;
  /** v6.71.0 (Cycle 27 G27-06) 新增：远程控制 */
  onOpenRemoteControl?: () => void;
  /** v6.72.0 (Cycle 28 G28-01) 新增：技能系统 (Codex Skills) */
  onOpenSkillSystem?: () => void;
  /** v6.73.0 (Cycle 28 G28-02) 新增：成本预算 */
  onOpenCostBudget?: () => void;
  /** v6.74.0 (Cycle 28 G28-03) 新增：用量归因 */
  onOpenUsageAttribution?: () => void;
  /** v6.75.0 (Cycle 28 G28-04) 新增：作用域权限 */
  onOpenScopedPermissions?: () => void;
  /** v6.76.0 (Cycle 28 G28-05) 新增：斜杠命令面板 */
  onOpenCommandPalette?: () => void;
  /** v6.77.0 (Cycle 29 G29-01) 新增：堆叠技能 */
  onOpenStackedSkills?: () => void;
  /** v6.78.0 (Cycle 29 G29-02) 新增：技能市场面板（区别于 Cycle 13 onOpenMarketplace 路由） */
  onOpenSkillsMarket?: () => void;
  /** v6.79.0 (Cycle 29 G29-03) 新增：分析聊天 */
  onOpenAnalyticsChat?: () => void;
  /** v6.83.0 (Cycle 30 G30-01) 新增：成本阈值告警 */
  onOpenCostThreshold?: () => void;
  /** v6.84.0 (Cycle 30 G30-02) 新增：动态工作流 */
  onOpenDynamicWorkflow?: () => void;
  /** v6.85.0 (Cycle 30 G30-03) 新增：编排多代理 */
  onOpenOrchestratedAgent?: () => void;
  /** v6.86.0 (Cycle 31 G31-01) 新增：成本归因 */
  onOpenCostAttribution?: () => void;
  /** v6.87.0 (Cycle 31 G31-02) 新增：远程 Worktree */
  onOpenRemoteWorktree?: () => void;
  /** v6.88.0 (Cycle 31 G31-03) 新增：Worktree 状态同步 */
  onOpenWorktreeSync?: () => void;
  /** v6.89.0 (Cycle 32 G32-01) 新增：审计追踪 */
  onOpenAuditTrail?: () => void;
  /** v6.90.0 (Cycle 32 G32-02) 新增：单点登录 */
  onOpenSSO?: () => void;
  /** v6.91.0 (Cycle 32 G32-03) 新增：策略规则 */
  onOpenPolicy?: () => void;
  /** v6.94.0 (Cycle 33 G33-01) 新增：企业全场景工作流 */
  onOpenEnterpriseWorkflow?: () => void;
  /** v6.94.0 (Cycle 33 G33-02) 新增：集成 Dashboard */
  onOpenUnifiedDashboard?: () => void;
  /** v6.94.0 (Cycle 33 G33-03) 新增：安全审计 */
  onOpenSecurityAudit?: () => void;
  /** v6.97.0 (Cycle 34 G34-01) 新增：端云模型路由 */
  onOpenEdgeModelRouter?: () => void;
  /** v6.97.0 (Cycle 34 G34-02) 新增：离线优先工作流 */
  onOpenOfflineFirst?: () => void;
  /** v6.97.0 (Cycle 34 G34-03) 新增：设备集群管理 */
  onOpenDeviceCluster?: () => void;
  /** v6.98.0 (Cycle 35 G35-01) 新增：工作流编排 */
  onOpenWorkflowOrchestrator?: () => void;
  /** v6.98.0 (Cycle 35 G35-02) 新增：智能体通信 */
  onOpenAgentCommunication?: () => void;
  /** v6.98.0 (Cycle 35 G35-03) 新增：任务检查点 */
  onOpenTaskCheckpoint?: () => void;
  /** v6.98.0 (Cycle 35 G35-04) 新增：智能体调度 */
  onOpenAgentScheduler?: () => void;
  /** v2.18.0 (Cycle 36 G36-01) 新增：LLM Provider 管理 */
  onOpenLLMProvider?: () => void;
  /** v2.18.0 (Cycle 36 G36-02) 新增：流式对话演示 */
  onOpenStreamingChat?: () => void;
  /** v2.18.0 (Cycle 36 G36-03) 新增：多模态处理 */
  onOpenMultiModal?: () => void;
  /** v2.19.0 (Cycle 37 G37-01) 新增：RAG 知识库 */
  onOpenRAG?: () => void;
  /** v2.19.0 (Cycle 37 G37-02) 新增：Tool Use 工具市场 */
  onOpenToolMarketplace?: () => void;
  /** v2.19.0 (Cycle 37 G37-03) 新增：Agent Loop 智能体循环 */
  onOpenAgentLoop?: () => void;
  /** v2.19.0 (Cycle 37 G37-04) 新增：真实 LLM Provider 配置 */
  onOpenRealLLMProvider?: () => void;
  /** v2.20.0 (Cycle 38 G38-01) 新增：多 Agent 协作 */
  onOpenMultiAgentCrew?: () => void;
  /** v2.20.0 (Cycle 38 G38-02) 新增：长期记忆管理 */
  onOpenLongTermMemory?: () => void;
  /** v2.20.0 (Cycle 38 G38-03) 新增：反思与自我修正 */
  onOpenReflection?: () => void;
  /** v2.20.0 (Cycle 38 G38-04) 新增：人机协作审批 */
  onOpenHumanApproval?: () => void;
}

/**
 * 内联 SVG 图标渲染器
 * 参数：
 *   - name: 图标键
 *   - className: 尺寸/颜色类名
 * 返回值：JSX 元素
 */
function Icon({ name, className = 'w-5 h-5' }: { name: 'zap' | 'plus' | 'more' | 'chart' | 'settings' | 'trash' | 'folder' | 'rocket' | 'plug' | 'compress' | 'sparkles' | 'book' | 'shield' | 'cpu' | 'plan' | 'hook' | 'brain' | 'chain' | 'cache' | 'stream' | 'oauth' | 'rollout' | 'tree' | 'shield-check' | 'brain-network' | 'image' | 'target' | 'layers' | 'background-tasks' | 'best-of-n' | 'design-mode' | 'git-branch' | 'git-commit' | 'webhook' | 'route' | 'side-chat' | 'predict' | 'performance' | 'admin' | 'learning' | 'replay' | 'suggestion' | 'figma' | 'search-check' | 'bot' | 'gauge' | 'csv' | 'shield-alert' | 'palette' | 'nested' | 'checkpoint' | 'messaging' | 'template' | 'remote' | 'cost-threshold' | 'workflow' | 'orchestrate' | 'attribution' | 'cloud' | 'sync' | 'audit' | 'sso' | 'policy' | 'enterprise-workflow' | 'unified-dashboard' | 'security-shield' | 'edge-cloud' | 'offline' | 'devices' | 'chat' | 'scheduler' | 'llm' | 'multimodal' | 'rag' | 'tool' | 'loop' | 'real-llm' | 'multi-agent' | 'memory' | 'reflection' | 'approval'; className?: string }) {
  switch (name) {
    case 'zap':
      // 闪电 - Logo 内图标
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      );
    case 'plus':
      // 加号 - 新建对话
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'more':
      // 三个水平点 - 下拉菜单触发器
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
          <circle cx="5" cy="12" r="1" />
        </svg>
      );
    case 'chart':
      // 柱状图 - 用量监控
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M3 3v18h18" />
          <path d="M7 16V10" />
          <path d="M11 16V6" />
          <path d="M15 16v-4" />
          <path d="M19 16v-8" />
        </svg>
      );
    case 'settings':
      // 齿轮 - 设置
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'trash':
      // 垃圾桶 - 回收站
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M3 6h18" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
      );
    case 'folder':
      // v1.1.0 新增：FolderTree - 文件浏览器（菜单项图标）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          <path d="M3 7h18M9 12h6M9 16h6" />
        </svg>
      );
    case 'rocket':
      // v1.4.0 新增：火箭 - Loop v7 端到端工作流（菜单项图标）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
          <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
          <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
          <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
        </svg>
      );
    case 'plug':
      // v1.6.0 新增：插头 - MCP 工具（菜单项图标）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 22v-5" />
          <path d="M9 7V2" />
          <path d="M15 7V2" />
          <path d="M6 13V8h12v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4z" />
        </svg>
      );
    case 'compress':
      // v1.6.0 新增：压缩 - 会话压缩（菜单项图标）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M4 9l4-4M4 9h6V3" />
          <path d="M20 15l-4 4m4-4h-6v6" />
        </svg>
      );
    case 'sparkles':
      // v1.6.0 新增：闪光 - 技能管理（菜单项图标）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z" />
        </svg>
      );
    case 'book':
      // v1.6.0 新增：书 - AGENTS.md 记忆（菜单项图标）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
      );
    case 'shield':
      // Cycle 3 v1.0.0 新增：盾牌 - MCP 高级功能（权限/审批/审计）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case 'cpu':
      // Cycle 3 v1.0.0 新增：CPU - 双触发压缩 / 规则扫描（技术感）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
        </svg>
      );
    case 'plan':
      // v2.0.0 (Cycle 4 P0-3) 新增：Plan - 计划编辑（清单+复选框感）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
          <path d="M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case 'hook':
      // v2.1.0 (Cycle 4 P0-4) 新增：Hook - 钩子事件（U 形弯钩）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M18 9V4a2 2 0 00-2-2h-3a2 2 0 00-2 2v15a6 6 0 006 6 6 6 0 006-6V11a2 2 0 00-2-2h-1" />
          <circle cx="15" cy="6" r="2" />
        </svg>
      );
    case 'chain':
      // v2.3.0 (Cycle 5 P0-6) 新增：Chain - 触发链路（链条节点）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      );
    case 'stream':
      // v2.5.0 (Cycle 6 P0-7-B) 新增：Stream - 流式恢复网关（波浪线+断点）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M2 12c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2" />
          <path d="M2 17c2 0 2-2 4-2s2 2 4 2 2-2 4-2 2 2 4 2 2-2 4-2" />
          <circle cx="20" cy="6" r="2" fill="currentColor" />
        </svg>
      );
    case 'oauth':
      // v2.6.0 (Cycle 7 P0-8) 新增：OAuth 2.1 + PKCE（锁+钥匙）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <rect x="4" y="11" width="16" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 1 1 8 0v4" />
          <circle cx="12" cy="16" r="1.5" fill="currentColor" />
          <path d="M12 17.5v2.5" />
        </svg>
      );
    case 'rollout':
      // v2.7.0 (Cycle 7 P0-9) 新增：Session Rollout JSONL（卷轴+播放）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
          <line x1="8" y1="8" x2="16" y2="8" />
          <line x1="8" y1="12" x2="16" y2="12" />
          <line x1="8" y1="16" x2="13" y2="16" />
          <path d="M16 18l2-1.5L16 15" />
        </svg>
      );
    case 'tree':
      // v2.8.0 (Cycle 7 P0-10) 新增：Multi-Agent v2 Path Tree（树状层级）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M5 3v18" />
          <path d="M5 7h6" />
          <path d="M5 12h8" />
          <path d="M5 17h10" />
          <circle cx="5" cy="3" r="1.5" fill="currentColor" />
          <circle cx="11" cy="7" r="1.5" fill="currentColor" />
          <circle cx="13" cy="12" r="1.5" fill="currentColor" />
          <circle cx="15" cy="17" r="1.5" fill="currentColor" />
        </svg>
      );
    case 'image':
      // v1.0.0 (Cycle 14 P0-2) 新增：多模态支持（图框+山峰，表达 Vision 视觉）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      );
    case 'shield-check':
      // v2.9.0 (Cycle 7 P0-11) 新增：TRACE 规则管理（盾牌+勾, 表达 enforcement）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case 'brain-network':
      // v2.11.0 (Cycle 8 P0-14) 新增：Custom Models（大脑+网络节点, 表达多模型）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="18" cy="6" r="2.5" />
          <circle cx="12" cy="18" r="2.5" />
          <circle cx="12" cy="12" r="3" />
          <path d="M8 8l3 3M16 8l-3 3M12 15v-1" />
        </svg>
      );
    case 'target':
      // v1.0.0 (Cycle 14 P1-4) 新增：Goal Automation（靶心+外圈，表达目标+轮转）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
        </svg>
      );
    case 'layers':
      // v6.36.0 (Cycle 16 P0-1) 新增：Composer 多文件编辑（堆叠图层，表达多文件协调）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      );
    case 'background-tasks':
      // v6.41.0 (Cycle 19 P0-1) 新增：后台任务（任务清单+勾选，表达后台异步执行）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="3" y1="9" x2="9" y2="9" />
          <line x1="13" y1="9" x2="17" y2="9" />
          <line x1="13" y1="13" x2="17" y2="13" />
          <line x1="13" y1="17" x2="15" y2="17" />
          <path d="M5 6l1 1 2-2" />
          <path d="M5 12l1 1 2-2" />
        </svg>
      );
    case 'best-of-n':
      // v6.42.0 (Cycle 19 P0-2) 新增：多模型对比（天平+刻度，表达对比）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 3v18" />
          <path d="M5 7h14" />
          <path d="M5 7l-2 4a4 4 0 008 0L9 7" />
          <path d="M19 7l-2 4a4 4 0 008 0l-2-4" />
          <path d="M8 21h8" />
        </svg>
      );
    case 'design-mode':
      // v6.43.0 (Cycle 19 P0-3) 新增：设计模式（十字箭头+边框，表达框选）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M3 3h6v6H3z" />
          <path d="M15 3h6v6h-6z" />
          <path d="M3 15h6v6H3z" />
          <path d="M15 15h6v6h-6z" />
          <path d="M9 6h6M9 18h6M6 9v6M18 9v6" />
        </svg>
      );
    case 'git-branch':
      // v6.45.0 (Cycle 20 P0-1) 新增：Git 分支（树形分支 + 节点）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
      );
    case 'git-commit':
      // Git 提交 - 备用图标
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <circle cx="12" cy="12" r="4" />
          <line x1="1.05" y1="12" x2="7" y2="12" />
          <line x1="17.01" y1="12" x2="22.96" y2="12" />
        </svg>
      );
    case 'webhook':
      // v6.47.0 (Cycle 20 P0-3) 新增：Webhook（钩子+链接）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2" />
          <path d="m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06" />
          <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8" />
        </svg>
      );
    case 'route':
      // 路由 - 备用图标
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <circle cx="6" cy="19" r="3" />
          <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
          <circle cx="18" cy="5" r="3" />
        </svg>
      );
    case 'side-chat':
      // Side Chat - 多子对话图标（聊天气泡 + 分支）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M8 9h8" />
          <path d="M8 13h6" />
        </svg>
      );
    case 'predict':
      // 成本预测 - 折线上箭头
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    case 'performance':
      // 性能分析 - 时速表
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 14l4-4" />
          <path d="M3.34 19a10 10 0 1 1 17.32 0" />
        </svg>
      );
    case 'admin':
      // 模型路由管理 - 盾牌 + 勾
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case 'learning':
      // 候选学习 - 大脑 + 节点
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2z" />
          <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2z" />
        </svg>
      );
    case 'replay':
      // 会话回放 - 快退箭头
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
      );
    case 'suggestion':
      // AI 主动建议 - 灯泡
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M9 18h6" />
          <path d="M10 22h4" />
          <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
        </svg>
      );
    case 'search-check':
      // 自动化代码评审 - 放大镜+对勾
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z" />
          <path d="m21 21-4.3-4.3" />
          <path d="m9 11 2 2 4-4" />
        </svg>
      );
    case 'bot':
      // PR 自动机器人 - 机器人图标
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 8V4H8" />
          <rect width="16" height="12" x="4" y="8" rx="2" />
          <path d="M2 14h2" />
          <path d="M20 14h2" />
          <path d="M15 13v2" />
          <path d="M9 13v2" />
        </svg>
      );
    case 'gauge':
      // AI 性能优化器 - 仪表盘
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="m12 14 4-4" />
          <path d="M3.34 19a10 10 0 1 1 17.32 0" />
        </svg>
      );
    case 'csv':
      // v6.64.0 (Cycle 26 G26-01) 新增：CSV 批处理（表格+箭头）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <path d="m13 14 3 3-3 3" />
        </svg>
      );
    case 'shield-alert':
      // v6.65.0 (Cycle 26 G26-02) 新增：智能审批（盾牌+警告）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </svg>
      );
    case 'palette':
      // v6.66.0 (Cycle 26 G26-03) 新增：MTC 多模任务（调色板）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
          <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
          <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
          <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-4.96-4.49-9-10-9z" />
        </svg>
      );
    case 'nested':
      // v6.67.0 (Cycle 27 G27-01) 新增：嵌套子代理（分层树形结构）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <rect x="9" y="2" width="6" height="5" rx="1" />
          <rect x="2" y="17" width="6" height="5" rx="1" />
          <rect x="16" y="17" width="6" height="5" rx="1" />
          <path d="M12 7v4M5 17v-2a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2" />
        </svg>
      );
    case 'checkpoint':
      // v6.68.0 (Cycle 27 G27-02) 新增：代理检查点（书签/存档）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          <path d="M12 7v4M12 15h.01" />
        </svg>
      );
    case 'messaging':
      // v6.69.0 (Cycle 27 G27-04) 新增：代理消息（对话气泡）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M8 9h8M8 13h6" />
        </svg>
      );
    case 'template':
      // v6.70.0 (Cycle 27 G27-05) 新增：代理模板（层叠卡片）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <rect x="3" y="3" width="14" height="14" rx="2" />
          <path d="M7 7h6M7 11h6M7 15h4" />
          <path d="M17 17v4M21 17v4M19 17v4" />
        </svg>
      );
    case 'remote':
      // v6.71.0 (Cycle 27 G27-06) 新增：远程控制（设备+信号）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <rect x="2" y="6" width="14" height="12" rx="2" />
          <path d="M22 8l-6 4 6 4V8z" />
          <path d="M6 10h6M6 14h4" />
        </svg>
      );
    case 'cost-threshold':
      // v6.83.0 (Cycle 30 G30-01) 新增：成本阈值告警（美元符号 + 上升趋势）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      );
    case 'workflow':
      // v6.84.0 (Cycle 30 G30-02) 新增：动态工作流（齿轮 + 节点）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="6" r="2" />
          <circle cx="12" cy="18" r="2" />
          <path d="M6 8v4a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8M12 14v2" />
        </svg>
      );
    case 'orchestrate':
      // v6.85.0 (Cycle 30 G30-03) 新增：编排多代理（指挥家）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      );
    case 'attribution':
      // v6.86.0 (Cycle 31 G31-01) 新增：成本归因（饼图分布）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M21 12a9 9 0 1 1-9-9v9h9z" />
          <path d="M21 12a9 9 0 0 0-9-9" />
        </svg>
      );
    case 'cloud':
      // v6.87.0 (Cycle 31 G31-02) 新增：远程 Worktree（云端）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
        </svg>
      );
    case 'sync':
      // v6.88.0 (Cycle 31 G31-03) 新增：Worktree 状态同步（双向箭头）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      );
    case 'audit':
      // v6.89.0 (Cycle 32 G32-01) 新增：审计追踪（盾牌 + 勾）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case 'sso':
      // v6.90.0 (Cycle 32 G32-02) 新增：单点登录（钥匙 + 圆环）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <circle cx="8" cy="15" r="4" />
          <path d="M10.85 12.15L19 4" />
          <path d="M18 5l3 3" />
          <path d="M15 8l3 3" />
        </svg>
      );
    case 'policy':
      // v6.91.0 (Cycle 32 G32-03) 新增：策略规则（文档 + 勾）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <path d="M9 15l2 2 4-4" />
        </svg>
      );
    case 'enterprise-workflow':
      // v6.94.0 (Cycle 33 G33-01) 新增：企业全场景工作流（齿轮）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      );
    case 'unified-dashboard':
      // v6.94.0 (Cycle 33 G33-02) 新增：集成 Dashboard（柱状图）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <rect x="3" y="3" width="7" height="9" />
          <rect x="14" y="3" width="7" height="5" />
          <rect x="14" y="12" width="7" height="9" />
          <rect x="3" y="16" width="7" height="5" />
        </svg>
      );
    case 'security-shield':
      // v6.94.0 (Cycle 33 G33-03) 新增：安全审计（盾牌 + 警告）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      );
    case 'edge-cloud':
      // v6.97.0 (Cycle 34 G34-01) 新增：端云模型路由（云 + 端双向箭头）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
          <polyline points="8 14 12 18 16 14" />
          <line x1="12" y1="18" x2="12" y2="10" />
        </svg>
      );
    case 'offline':
      // v6.97.0 (Cycle 34 G34-02) 新增：离线优先（云 + 断线符号）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
          <line x1="3" y1="3" x2="21" y2="21" />
        </svg>
      );
    case 'devices':
      // v6.97.0 (Cycle 34 G34-03) 新增：设备集群管理（多设备 + 信号）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <rect x="2" y="3" width="14" height="9" rx="1" />
          <rect x="13" y="12" width="9" height="9" rx="1" />
          <path d="M5 6h.01M16 15h.01" />
          <path d="M11 21h-4" />
        </svg>
      );
    case 'chat':
      // v6.99.0 (Cycle 35 G35-02) 新增：智能体通信
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      );
    case 'scheduler':
      // v6.99.0 (Cycle 35 G35-04) 新增：智能体调度
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      );
    case 'llm':
      // v2.18.0 (Cycle 36 G36-01) 新增：LLM Provider
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
          <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z" />
        </svg>
      );
    case 'multimodal':
      // v2.18.0 (Cycle 36 G36-03) 新增：多模态
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
      );
    case 'rag':
      // v2.19.0 (Cycle 37 G37-01) 新增：RAG 知识库（书本+齿轮组合）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          <circle cx="12" cy="8" r="2" />
          <path d="M12 14l-2 4M12 14l2 4M12 14v-4" />
        </svg>
      );
    case 'tool':
      // v2.19.0 (Cycle 37 G37-02) 新增：Tool Use（工具箱）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      );
    case 'loop':
      // v2.19.0 (Cycle 37 G37-03) 新增：Agent Loop（循环箭头）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      );
    case 'real-llm':
      // v2.19.0 (Cycle 37 G37-04) 新增：真实 LLM（云+API）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
          <path d="M9 14l2 2 4-4" />
        </svg>
      );
    case 'multi-agent':
      // v2.20.0 (Cycle 38 G38-01) 新增：多 Agent 协作（三个节点网络）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <circle cx="12" cy="5" r="2" />
          <circle cx="5" cy="19" r="2" />
          <circle cx="19" cy="19" r="2" />
          <path d="M12 7v3M12 10l-7 9M12 10l7 9" />
        </svg>
      );
    case 'memory':
      // v2.20.0 (Cycle 38 G38-02) 新增：长期记忆（数据库+时钟）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v6c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          <path d="M3 11v6c0 1.66 4 3 9 3s9-1.34 9-3v-6" />
          <circle cx="17" cy="18" r="2.5" />
          <path d="M17 16.5v1.5l1 1" />
        </svg>
      );
    case 'reflection':
      // v2.20.0 (Cycle 38 G38-03) 新增：反思与自我修正（镜像+箭头）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
          <circle cx="12" cy="12" r="4" />
          <path d="M10 10h4M10 14h4" />
        </svg>
      );
    case 'approval':
      // v2.20.0 (Cycle 38 G38-04) 新增：人机协作审批（盾牌+勾选）
      return (
        <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
          <path d="M12 2l8 4v6c0 5-3.5 9.5-8 10-4.5-.5-8-5-8-10V6l8-4z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    default:
      return null;
  }
}

/**
 * 极简顶部品牌栏组件
 * - 高度 56px（h-14），sticky 吸顶，半透明背景 + 底部细边
 * - Logo + Session 标题 + 新建按钮 + 三个点菜单
 * - 移动端（< 768px）隐藏中间标题
 */
export default function BrandHeader({
  sessionTitle,
  onNewChat,
  newChatLoading = false,
  onOpenSettings,
  onOpenTrash,
  onOpenUsage,
  onOpenFileExplorer,
  fileExplorerOpen,
  onOpenLoopV7,
  onOpenDiffView,
  onOpenMemory,
  onOpenVerification,
  onOpenDoctor,
  onOpenLlmJudge,
  onOpenMarketplace,
  onOpenMultimodal,
  onOpenEnterpriseHub,
  onOpenTraeWork,
  onOpenGoalAutomation,
  onOpenGoalTemplates,
  onOpenMCP,
  onOpenCompaction,
  onOpenSkills,
  onOpenAgentsMd,
  onOpenCycle3,
  onOpenDualCompaction,
  onOpenRules,
  /** v2.0.0 (Cycle 4 P0-3) 新增 */
  onOpenPlanEditor,
  /** v2.1.0 (Cycle 4 P0-4) 新增 */
  onOpenHooks,
  /** v2.2.0 (Cycle 4 P0-4) 新增 */
  onOpenSubagentMemory,
  /** v2.3.0 (Cycle 5 P0-6) 新增 */
  onOpenHookChain,
  /** v2.4.0 (Cycle 6 P0-7-A) 新增 */
  onOpenCacheStats,
  /** v2.5.0 (Cycle 6 P0-7-B) 新增 */
  onOpenStreamList,
  /** v2.6.0 (Cycle 7 P0-8) 新增 */
  onOpenOAuthConfig,
  /** v2.7.0 (Cycle 7 P0-9) 新增 */
  onOpenSessionRollout,
  /** v2.8.0 (Cycle 7 P0-10) 新增 */
  onOpenMultiAgentTree,
  /** v2.9.0 (Cycle 7 P0-11) 新增 */
  onOpenTraceRule,
  /** v2.10.0 (Cycle 8 P0-12) 新增 */
  onOpenSlashCommand,
  /** v2.11.0 (Cycle 8 P0-14) 新增 */
  onOpenCustomModels,
  onOpenMcpRegistry,
  /** v2.21.0 (Cycle 41) 新增 */
  onOpenMcpAdvanced,
  /** v6.36.0 (Cycle 16 P0-1) 新增：Composer 多文件编辑 */
  onOpenComposer,
  /** v6.41.0 (Cycle 19 P0-1) 新增：后台任务 */
  onOpenBackgroundTasks,
  /** v6.42.0 (Cycle 19 P0-2) 新增：Best-of-N */
  onOpenBestOfN,
  /** v6.43.0 (Cycle 19 P0-3) 新增：Design Mode */
  onOpenDesignMode,
  /** v6.45.0 (Cycle 20 P0-1) 新增：Worktree 隔离 */
  onOpenWorktree,
  /** v6.46.0 (Cycle 20 P0-2) 新增：智能模型路由 */
  onOpenModelRouter,
  /** v6.47.0 (Cycle 20 P0-3) 新增：事件钩子 */
  onOpenHooks20,
  /** v6.48.0 (Cycle 21 P0-1) 新增：Best-of-N × Worktree 协同 */
  onOpenBestOfNCoordinator,
  /** v6.49.0 (Cycle 21 P0-2) 新增：模型路由成本统计 */
  onOpenModelRouterStats,
  /** v6.50.0 (Cycle 21 P0-4) 新增：Hook 模板市场 */
  onOpenHooksMarketplace,
  /** v6.51.0 (Cycle 22 G22-01) 新增：Side Chat 多子对话 */
  onOpenSideChat,
  /** v6.52.0 (Cycle 22 G22-02) 新增：成本预测 */
  onOpenCostPrediction,
  /** v6.53.0 (Cycle 22 G22-03) 新增：Hook 性能分析 */
  onOpenHookPerformance,
  /** v6.54.0 (Cycle 22 G22-04) 新增：模型路由管理 */
  onOpenModelRouterAdmin,
  /** v6.55.0 (Cycle 23 G23-01) 新增：候选学习 */
  onOpenCandidateLearning,
  /** v6.56.0 (Cycle 23 G23-02) 新增：会话回放 */
  onOpenSessionReplay,
  /** v6.57.0 (Cycle 23 G23-04) 新增：AI 主动建议 */
  onOpenProactiveSuggestion,
  /** v6.58.0 (Cycle 24 G24-01) 新增：全局记忆 */
  onOpenGlobalMemory,
  /** v6.59.0 (Cycle 24 G24-02) 新增：多任务并行编排 */
  onOpenMultiTask,
  /** v6.60.0 (Cycle 24 G24-04) 新增：Figma 设计稿转代码 */
  onOpenFigmaImport,
  /** v6.61.0 (Cycle 25 G25-01) 新增：自动化代码评审 */
  onOpenAutoCodeReview,
  /** v6.62.0 (Cycle 25 G25-02) 新增：PR 自动机器人 */
  onOpenPRBot,
  /** v6.63.0 (Cycle 25 G25-03) 新增：AI 性能优化器 */
  onOpenPerfOptimizer,
  /** v6.64.0 (Cycle 26 G26-01) 新增：CSV 批处理智能体 */
  onOpenCsvBatch,
  /** v6.65.0 (Cycle 26 G26-02) 新增：智能审批引擎 */
  onOpenSmartApproval,
  /** v6.66.0 (Cycle 26 G26-03) 新增：MTC 多模任务协作 */
  onOpenMTC,
  /** v6.67.0 (Cycle 27 G27-01) 新增：嵌套子代理 */
  onOpenNestedSubAgent,
  /** v6.68.0 (Cycle 27 G27-02) 新增：代理检查点 */
  onOpenAgentCheckpoint,
  /** v6.69.0 (Cycle 27 G27-04) 新增：代理消息 */
  onOpenAgentMessaging,
  /** v6.70.0 (Cycle 27 G27-05) 新增：代理模板 */
  onOpenAgentTemplate,
  /** v6.71.0 (Cycle 27 G27-06) 新增：远程控制 */
  onOpenRemoteControl,
  /** v6.72.0 (Cycle 28 G28-01) 新增：技能系统 */
  onOpenSkillSystem,
  /** v6.73.0 (Cycle 28 G28-02) 新增：成本预算 */
  onOpenCostBudget,
  /** v6.74.0 (Cycle 28 G28-03) 新增：用量归因 */
  onOpenUsageAttribution,
  /** v6.75.0 (Cycle 28 G28-04) 新增：作用域权限 */
  onOpenScopedPermissions,
  /** v6.76.0 (Cycle 28 G28-05) 新增：斜杠命令面板 */
  onOpenCommandPalette,
  /** v6.77.0 (Cycle 29 G29-01) 新增：堆叠技能 */
  onOpenStackedSkills,
  /** v6.78.0 (Cycle 29 G29-02) 新增：技能市场面板 */
  onOpenSkillsMarket,
  /** v6.79.0 (Cycle 29 G29-03) 新增：分析聊天 */
  onOpenAnalyticsChat,
  /** v6.83.0 (Cycle 30 G30-01) 新增：成本阈值告警 */
  onOpenCostThreshold,
  /** v6.84.0 (Cycle 30 G30-02) 新增：动态工作流 */
  onOpenDynamicWorkflow,
  /** v6.85.0 (Cycle 30 G30-03) 新增：编排多代理 */
  onOpenOrchestratedAgent,
  /** v6.86.0 (Cycle 31 G31-01) 新增：成本归因 */
  onOpenCostAttribution,
  /** v6.87.0 (Cycle 31 G31-02) 新增：远程 Worktree */
  onOpenRemoteWorktree,
  /** v6.88.0 (Cycle 31 G31-03) 新增：Worktree 状态同步 */
  onOpenWorktreeSync,
  /** v6.89.0 (Cycle 32 G32-01) 新增：审计追踪 */
  onOpenAuditTrail,
  /** v6.90.0 (Cycle 32 G32-02) 新增：单点登录 */
  onOpenSSO,
  /** v6.91.0 (Cycle 32 G32-03) 新增：策略规则 */
  onOpenPolicy,
  /** v6.94.0 (Cycle 33 G33-01) 新增：企业全场景工作流 */
  onOpenEnterpriseWorkflow,
  /** v6.94.0 (Cycle 33 G33-02) 新增：集成 Dashboard */
  onOpenUnifiedDashboard,
  /** v6.94.0 (Cycle 33 G33-03) 新增：安全审计 */
  onOpenSecurityAudit,
  /** v6.97.0 (Cycle 34 G34-01) 新增：端云模型路由 */
  onOpenEdgeModelRouter,
  /** v6.97.0 (Cycle 34 G34-02) 新增：离线优先工作流 */
  onOpenOfflineFirst,
  /** v6.97.0 (Cycle 34 G34-03) 新增：设备集群管理 */
  onOpenDeviceCluster,
  /** v6.98.0 (Cycle 35 G35-01) 新增：工作流编排 */
  onOpenWorkflowOrchestrator,
  /** v6.98.0 (Cycle 35 G35-02) 新增：智能体通信 */
  onOpenAgentCommunication,
  /** v6.98.0 (Cycle 35 G35-03) 新增：任务检查点 */
  onOpenTaskCheckpoint,
  /** v6.98.0 (Cycle 35 G35-04) 新增：智能体调度 */
  onOpenAgentScheduler,
  /** v2.18.0 (Cycle 36 G36-01) 新增：LLM Provider 管理 */
  onOpenLLMProvider,
  /** v2.18.0 (Cycle 36 G36-02) 新增：流式对话演示 */
  onOpenStreamingChat,
  /** v2.18.0 (Cycle 36 G36-03) 新增：多模态处理 */
  onOpenMultiModal,
  /** v2.19.0 (Cycle 37 G37-01) 新增：RAG 知识库 */
  onOpenRAG,
  /** v2.19.0 (Cycle 37 G37-02) 新增：Tool Use 工具市场 */
  onOpenToolMarketplace,
  /** v2.19.0 (Cycle 37 G37-03) 新增：Agent Loop 智能体循环 */
  onOpenAgentLoop,
  /** v2.19.0 (Cycle 37 G37-04) 新增：真实 LLM Provider 配置 */
  onOpenRealLLMProvider,
  /** v2.20.0 (Cycle 38 G38-01) 新增：多 Agent 协作 */
  onOpenMultiAgentCrew,
  /** v2.20.0 (Cycle 38 G38-02) 新增：长期记忆管理 */
  onOpenLongTermMemory,
  /** v2.20.0 (Cycle 38 G38-03) 新增：反思与自我修正 */
  onOpenReflection,
  /** v2.20.0 (Cycle 38 G38-04) 新增：人机协作审批 */
  onOpenHumanApproval,
}: BrandHeaderProps) {
  /** 下拉菜单开关状态 */
  const [menuOpen, setMenuOpen] = useState(false);
  /** 下拉菜单容器 ref（用于检测外部点击） */
  const menuRef = useRef<HTMLDivElement | null>(null);

  /**
   * 点击下拉菜单外部区域时自动关闭菜单
   * 绑定时机：menuOpen 为 true 时绑定；为 false 时解绑
   */
  useEffect(() => {
    if (!menuOpen) return;
    /**
     * 外部点击检测
     * 步骤：判断点击目标是否在 menuRef 容器内；不在则关闭菜单
     */
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  /**
   * 触发菜单项的通用回调包装
   * 步骤：调用外部回调 → 关闭菜单
   * 参数：
   *   - cb?: 外部回调（可能未提供）
   * 返回值：包装后的事件处理函数
   */
  const wrapMenuItem = useCallback((cb?: () => void) => () => {
    if (cb) cb();
    setMenuOpen(false);
  }, []);

  return (
    <header
      // sticky 吸顶 + 半透明背景 + backdrop-blur（玻璃质感）+ 底部 1px 边
      className="sticky top-0 z-40 h-14 bg-white/80 backdrop-blur-md border-b border-surface-200/60
                 flex items-center justify-between px-4"
    >
      {/* 左侧：Logo（圆形渐变 + 闪电图标） */}
      <div className="flex items-center gap-2">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-hermes-400 to-hermes-600 flex items-center justify-center shadow-glow-hermes">
          <Icon name="zap" className="w-5 h-5 text-white" />
        </div>
        {/* 品牌名（仅 md+ 显示，移动端隐藏） */}
        <span className="hidden md:inline text-lg font-medium text-surface-900">Hermes</span>
      </div>

      {/* 中间：v1.3.0 仅显示 Session 标题（仅 md+ 显示）；模式切换入口已移至 Sidebar/ProjectSelector */}
      <h2 className="hidden md:block text-body font-medium text-surface-700 truncate max-w-md">
        {sessionTitle}
      </h2>

      {/* 右侧：新建对话按钮 + 三个点下拉菜单 */}
      <div className="flex items-center gap-2">
        {/* 新建对话按钮：圆形，hover 时旋转 90° */}
        {/* v1.5.0：newChatLoading=true 时禁用按钮 + 显示旋转加载图标 + 灰化样式 */}
        <button
          onClick={onNewChat}
          disabled={newChatLoading}
          title={newChatLoading ? '创建中...' : '新建对话'}
          aria-label={newChatLoading ? '创建中...' : '新建对话'}
          aria-busy={newChatLoading}
          className={`w-9 h-9 rounded-full flex items-center justify-center shadow-glow-hermes-sm
                      transition-all duration-default ease-spring
                      ${newChatLoading
                        ? 'bg-surface-200 text-surface-500 cursor-not-allowed'
                        : 'bg-hermes-50 hover:bg-hermes-100 text-hermes-600 hover:rotate-90'
                      }`}
        >
          {newChatLoading ? (
            // 加载中：旋转的 spinner
            <svg
              className="w-5 h-5 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          ) : (
            <Icon name="plus" className="w-5 h-5" />
          )}
        </button>

        {/* 三个点下拉菜单 */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(prev => !prev)}
            title="更多操作"
            aria-label="更多操作"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="w-9 h-9 rounded-full hover:bg-surface-100 text-surface-600
                       flex items-center justify-center transition-colors duration-fast"
          >
            <Icon name="more" className="w-5 h-5" />
          </button>

          {/* 下拉菜单面板：仅在 menuOpen 时渲染 */}
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl
                         shadow-level-3 border border-surface-200 py-1
                         animate-lift-in z-50"
            >
              {/* v1.1.0 新增：文件浏览器（菜单首位，FolderTree 图标）
               *  行为：点击调 onOpenFileExplorer() 切换父组件 state + 关闭菜单
               *  状态指示：fileExplorerOpen=true 时右侧显示绿色实心圆 ●
               *           fileExplorerOpen=false 时显示灰色空心圆 ○
               *  父组件 App.tsx 仅在 appMode === 'coding' && selectedProject 时
               *  才透传 onOpenFileExplorer 回调，其他场景下本项不渲染 */}
              {onOpenFileExplorer && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenFileExplorer)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center justify-between
                             transition-colors duration-fast"
                >
                  <span className="flex items-center gap-2">
                    <Icon name="folder" className="w-4 h-4" />
                    <span>文件浏览器</span>
                  </span>
                  {/* 状态指示：●（已展开，hermes-500 实心） / ○（已折叠，surface-400 空心） */}
                  {fileExplorerOpen ? (
                    <span className="text-hermes-500 text-xs">●</span>
                  ) : (
                    <span className="text-surface-400 text-xs">○</span>
                  )}
                </button>
              )}

              {/* v1.4.0 新增：Loop v7 工作流（菜单项）
               *  行为：点击调 onOpenLoopV7() 弹出 LoopV7Runner 端到端运行器
               *  图标：火箭（rocket），强调端到端自动化全流程
               *  父组件 App.tsx 透传回调以激活本项 */}
              {onOpenLoopV7 && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenLoopV7)}
                  className="w-full px-4 py-2 text-left text-sm text-hermes-700
                             hover:bg-hermes-50 flex items-center gap-2
                             transition-colors duration-fast font-medium"
                >
                  <Icon name="rocket" className="w-4 h-4" />
                  <span>🚀 Loop v7 工作流</span>
                </button>
              )}

              {/* v2.0.0 (Cycle 9 P1-7) 新增：DiffView 多格式代码变更查看
               *  行为：点击跳转 /diff-view 路由打开 DiffView 页面
               *  图标：folder（文件夹），强调代码目录结构
               *  父组件 App.tsx 透传 onOpenDiffView 以激活本项 */}
              {onOpenDiffView && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenDiffView)}
                  className="w-full px-4 py-2 text-left text-sm text-blue-700
                             hover:bg-blue-50 flex items-center gap-2
                             transition-colors duration-fast font-medium"
                >
                  <Icon name="folder" className="w-4 h-4" />
                  <span>📋 DiffView 增强</span>
                </button>
              )}

              {/* v1.0.0 (Cycle 10 P1-8) 新增：Memory System 长期记忆管理
               *  行为：点击跳转 /memory 路由打开 Memory System 页面
               *  图标：folder，强调长期存储
               *  父组件 App.tsx 透传 onOpenMemory 以激活本项 */}
              {onOpenMemory && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenMemory)}
                  className="w-full px-4 py-2 text-left text-sm text-purple-700
                             hover:bg-purple-50 flex items-center gap-2
                             transition-colors duration-fast font-medium"
                >
                  <Icon name="folder" className="w-4 h-4" />
                  <span>🧠 Memory System</span>
                </button>
              )}

              {/* v1.0.0 (Cycle 10 P1-10) 新增：Verification Loop 验证闭环
               *  行为：点击跳转 /verification 路由打开验证闭环页面
               *  图标：folder，强调自动验证与修复闭环
               *  父组件 App.tsx 透传 onOpenVerification 以激活本项 */}
              {onOpenVerification && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenVerification)}
                  className="w-full px-4 py-2 text-left text-sm text-cyan-700
                             hover:bg-cyan-50 flex items-center gap-2
                             transition-colors duration-fast font-medium"
                >
                  <Icon name="folder" className="w-4 h-4" />
                  <span>🔁 Verification Loop</span>
                </button>
              )}

              {/* v1.0.0 (Cycle 11 P2-2) 新增：Doctor 环境诊断入口
               *  行为：点击跳转 /doctor 路由打开环境诊断页面
               *  图标：folder，强调健康检查与自动修复建议 */}
              {onOpenDoctor && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenDoctor)}
                  className="w-full px-4 py-2 text-left text-sm text-rose-700
                             hover:bg-rose-50 flex items-center gap-2
                             transition-colors duration-fast font-medium"
                >
                  <Icon name="folder" className="w-4 h-4" />
                  <span>🩺 Doctor 环境诊断</span>
                </button>
              )}

              {/* v1.0.0 (Cycle 13 P1-2) 新增：LLM-as-Judge 验证层入口
               *  行为：点击跳转 /llm-judge 路由打开 LLM Judge 页面
               *  图标：folder，强调 5 维度评分与多 Judge 共识 */}
              {onOpenLlmJudge && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenLlmJudge)}
                  className="w-full px-4 py-2 text-left text-sm text-amber-700
                             hover:bg-amber-50 flex items-center gap-2
                             transition-colors duration-fast font-medium"
                >
                  <Icon name="folder" className="w-4 h-4" />
                  <span>⚖️ LLM-as-Judge</span>
                </button>
              )}

              {/* v1.0.0 (Cycle 13 P1-3) 新增：Plugin Marketplace 入口
               *  行为：点击跳转 /marketplace 路由打开 Plugin 商城
               *  图标：folder，强调浏览/评分/发布插件 */}
              {onOpenMarketplace && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenMarketplace)}
                  className="w-full px-4 py-2 text-left text-sm text-indigo-700
                             hover:bg-indigo-50 flex items-center gap-2
                             transition-colors duration-fast font-medium"
                >
                  <Icon name="folder" className="w-4 h-4" />
                  <span>🏪 Plugin Marketplace</span>
                </button>
              )}

              {/* v1.0.0 (Cycle 14 P0-2) 新增：多模态支持入口
               *  行为：点击跳转 /multimodal 路由打开多模态分析页
               *  图标：image（新增），强调 Vision + Audio 智能分析 */}
              {onOpenMultimodal && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenMultimodal)}
                  className="w-full px-4 py-2 text-left text-sm text-violet-700
                             hover:bg-violet-50 flex items-center gap-2
                             transition-colors duration-fast font-medium"
                >
                  <Icon name="image" className="w-4 h-4" />
                  <span>🎨 多模态支持</span>
                </button>
              )}

              {/* v1.0.0 (Cycle 14 P0-3) 新增：企业级 Plugin Hub 入口
               *  行为：点击跳转 /enterprise-hub 路由打开企业级 Plugin Hub 页
               *  功能：90+ 插件目录、团队管理、RBAC、成本控制、审批、审计、Dashboard */}
              {onOpenEnterpriseHub && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenEnterpriseHub)}
                  className="w-full px-4 py-2 text-left text-sm text-indigo-700
                             hover:bg-indigo-50 flex items-center gap-2
                             transition-colors duration-fast font-medium"
                >
                  <span>🏢</span>
                  <span>Enterprise Plugin Hub</span>
                </button>
              )}

              {/* v1.0.0 (Cycle 14 P1-3) 新增：TRAE Work 多模态协作入口
               *  行为：点击跳转 /work 路由打开 TRAE Work 多模态协作页
               *  功能：Design Mode + Voice Chat + Global Memory + Video Studio */}
              {onOpenTraeWork && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenTraeWork)}
                  className="w-full px-4 py-2 text-left text-sm text-pink-700
                             hover:bg-pink-50 flex items-center gap-2
                             transition-colors duration-fast font-medium"
                >
                  <span>🧰</span>
                  <span>TRAE Work 多模态协作</span>
                </button>
              )}

              {/* v1.0.0 (Cycle 14 P1-4) 新增：Goal Automation 入口
               *  行为：点击跳转 /goal-automation 路由打开 Goal Automation 页面
               *  功能：Auto-Turn 自动轮转 + Agent 注册表 + 委派任务三合一 */}
              {onOpenGoalAutomation && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenGoalAutomation)}
                  className="w-full px-4 py-2 text-left text-sm text-blue-700
                             hover:bg-blue-50 flex items-center gap-2
                             transition-colors duration-fast font-medium"
                >
                  <Icon name="target" className="w-4 h-4" />
                  <span>🎯 Goal Automation</span>
                </button>
              )}

              {/* v1.0.0 (Cycle 14 P1-5) 新增：Goal Templates 模板库入口
               *  行为：点击跳转 /goal-templates 路由打开模板库页面
               *  功能：6 类内置模板 + Fork + 一键实例化 */}
              {onOpenGoalTemplates && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenGoalTemplates)}
                  className="w-full px-4 py-2 text-left text-sm text-violet-700
                             hover:bg-violet-50 flex items-center gap-2
                             transition-colors duration-fast font-medium"
                >
                  <Icon name="book" className="w-4 h-4" />
                  <span>📚 Goal 模板库</span>
                </button>
              )}

              {/* v1.6.0 新增：分组标题 - Cycle 2 高级功能 */}
              {(onOpenMCP || onOpenCompaction || onOpenSkills || onOpenAgentsMd) && (
                <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-surface-400 font-medium">
                  高级功能
                </div>
              )}

              {/* v1.6.0 新增：MCP 工具（菜单项）
               *  行为：点击调 onOpenMCP() 弹出 McpPanel 工具调用面板
               *  图标：插头（plug），强调外部工具集成 */}
              {onOpenMCP && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenMCP)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="plug" className="w-4 h-4" />
                  <span>🔌 MCP 工具</span>
                </button>
              )}

              {/* v1.6.0 新增：会话压缩（菜单项）
               *  行为：点击调 onOpenCompaction() 弹出 CompactionIndicator
               *  图标：压缩（compress），强调长会话上下文管理 */}
              {onOpenCompaction && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenCompaction)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="compress" className="w-4 h-4" />
                  <span>🗜️ 会话压缩</span>
                </button>
              )}

              {/* v1.6.0 新增：技能管理（菜单项）
               *  行为：点击调 onOpenSkills() 弹出 Skills 管理面板
               *  图标：闪光（sparkles），强调 Skills 插件系统 */}
              {onOpenSkills && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenSkills)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="sparkles" className="w-4 h-4" />
                  <span>✨ 技能管理</span>
                </button>
              )}

              {/* v1.6.0 新增：AGENTS.md 记忆（菜单项）
               *  行为：点击调 onOpenAgentsMd() 弹出 AGENTS.md 记忆管理
               *  图标：书（book），强调项目级规则持久化 */}
              {onOpenAgentsMd && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenAgentsMd)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="book" className="w-4 h-4" />
                  <span>📚 AGENTS.md 记忆</span>
                </button>
              )}

              {/* Cycle 3 v1.0.0 新增：分组标题 - Cycle 3 高级功能 */}
              {(onOpenCycle3 || onOpenDualCompaction || onOpenRules) && (
                <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-surface-400 font-medium border-t border-surface-100 mt-1">
                  Cycle 3 新功能
                </div>
              )}

              {/* Cycle 3 v1.0.0 新增：MCP 高级功能（菜单项）
               *  行为：点击调 onOpenCycle3() 弹出 Cycle3Panel 权限/服务器/审批/审计面板
               *  图标：盾牌（shield），强调权限保护与安全控制 */}
              {onOpenCycle3 && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenCycle3)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-indigo-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="shield" className="w-4 h-4 text-indigo-500" />
                  <span>🛡️ MCP 高级功能</span>
                </button>
              )}

              {/* Cycle 3 v1.0.0 新增：双触发压缩（菜单项）
               *  行为：点击调 onOpenDualCompaction() 弹出 DualCompactionPanel
               *  图标：CPU（cpu），强调双触发机制与计算密集 */}
              {onOpenDualCompaction && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenDualCompaction)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-amber-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="cpu" className="w-4 h-4 text-amber-500" />
                  <span>⚡ 双触发压缩</span>
                </button>
              )}

              {/* Cycle 3 v1.0.0 新增：多类型规则扫描（菜单项）
               *  行为：点击调 onOpenRules() 弹出 RulesPanel 多文件类型扫描面板
               *  图标：CPU（cpu），强调多文件类型 + 4 层架构 */}
              {onOpenRules && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenRules)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-teal-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="cpu" className="w-4 h-4 text-teal-500" />
                  <span>📜 多类型规则扫描</span>
                </button>
              )}

              {/* v2.0.0 (Cycle 4 P0-3) 新增：分组标题 - Cycle 4 计划模式 */}
              {onOpenPlanEditor && (
                <div className="px-4 pt-2 pb-1 text-[10px] uppercase tracking-wider text-surface-400 font-medium border-t border-surface-100 mt-1">
                  Cycle 4 新功能
                </div>
              )}

              {/* v2.0.0 (Cycle 4 P0-3) 新增：Plan 编辑器（菜单项）
               *  行为：点击调 onOpenPlanEditor() 弹出 PlanEditorModal
               *       Plan → Execute → Rollback 完整链路
               *  图标：plan（清单+复选框），强调计划编辑+风险点+回滚 */}
              {onOpenPlanEditor && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenPlanEditor)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-purple-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="plan" className="w-4 h-4 text-purple-500" />
                  <span>📋 Plan 编辑器</span>
                </button>
              )}

              {/* v2.1.0 (Cycle 4 P0-4) 新增：Hooks 事件系统（菜单项）
               *  行为：点击调 onOpenHooks() 弹出 HooksPanel
               *       仿照 Codex v0.150+ Hooks 规范设计（10 类事件）
               *  图标：hook（U 形弯钩），强调事件触发+执行+审计 */}
              {onOpenHooks && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenHooks)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-cyan-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="hook" className="w-4 h-4 text-cyan-500" />
                  <span>🪝 Hooks 事件系统</span>
                </button>
              )}

              {/* v2.2.0 (Cycle 4 P0-4) 新增：SubAgent 记忆（菜单项）
               *  行为：点击调 onOpenSubagentMemory() 弹出 SubAgentMemoryViewer
               *       对应 TRAE Sub Agent 三大组件中的"独立工作区"
               *  图标：brain（脑），强调独立 context + 父→子记忆继承 */}
              {onOpenSubagentMemory && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenSubagentMemory)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-pink-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="brain" className="w-4 h-4 text-pink-500" />
                  <span>🧠 SubAgent 记忆</span>
                </button>
              )}

              {/* v2.3.0 (Cycle 5 P0-6) 新增：Hook 触发链路 */}
              {onOpenHookChain && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenHookChain)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-cyan-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="chain" className="w-4 h-4 text-cyan-500" />
                  <span>🔗 Hook 触发链路</span>
                </button>
              )}

              {/* v2.4.0 (Cycle 6 P0-7-A) 新增：LLM 缓存统计 */}
              {onOpenCacheStats && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenCacheStats)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-emerald-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="cache" className="w-4 h-4 text-emerald-500" />
                  <span>⚡ LLM 缓存统计</span>
                </button>
              )}

              {/* v2.5.0 (Cycle 6 P0-7-B) 新增：流式恢复网关 */}
              {onOpenStreamList && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenStreamList)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-blue-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="stream" className="w-4 h-4 text-blue-500" />
                  <span>🌊 流式恢复网关</span>
                </button>
              )}

              {/* v2.6.0 (Cycle 7 P0-8) 新增：OAuth 2.1 + PKCE（菜单项）
               *  行为：点击调 onOpenOAuthConfig() 弹出 OAuthConfigModal
               *       符合 MCP Authorization Spec 2026-06-18 强制规范
               *  图标：oauth（锁+钥匙），强调授权 + 安全 */}
              {onOpenOAuthConfig && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenOAuthConfig)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-indigo-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="oauth" className="w-4 h-4 text-indigo-500" />
                  <span>🔐 OAuth 2.1 + PKCE</span>
                </button>
              )}

              {/* v2.7.0 (Cycle 7 P0-9) 新增：Session Rollout JSONL（菜单项）
               *  行为：点击调 onOpenSessionRollout() 弹出 SessionRolloutPanel
               *       实现 Codex v0.136+ thread/fork JSONL 持久化格式
               *  图标：rollout（卷轴+播放），强调持久化 + 历史回放 */}
              {onOpenSessionRollout && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenSessionRollout)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-blue-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="rollout" className="w-4 h-4 text-blue-500" />
                  <span>📜 Session Rollout JSONL</span>
                </button>
              )}

              {/* v2.8.0 (Cycle 7 P0-10) 新增：Multi-Agent v2 Path Tree（菜单项）
               *  行为：点击调 onOpenMultiAgentTree() 弹出 MultiAgentTreePanel
               *       实现 Codex v0.121+ path-based addressing 多智能体编排
               *  图标：tree（树状层级），强调 path-based addressing + spawn/wait/close */}
              {onOpenMultiAgentTree && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenMultiAgentTree)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-emerald-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="tree" className="w-4 h-4 text-emerald-500" />
                  <span>🌳 Multi-Agent v2 Path Tree</span>
                </button>
              )}

              {/* v2.9.0 (Cycle 7 P0-11) 新增：TRACE 规则管理（菜单项）
               *  行为：点击调 onOpenTraceRule() 弹出 RulePanel 规则管理面板
               *       实现 Zhou et al. June 2026 论文：用户纠正编译为运行时强制规则
               *  图标：shield-check（盾牌+勾），表达 enforcement + compliance */}
              {onOpenTraceRule && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenTraceRule)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-rose-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="shield-check" className="w-4 h-4 text-rose-500" />
                  <span>🛡️ TRACE 规则管理</span>
                </button>
              )}

              {/* v2.10.0 (Cycle 8 P0-12) 新增：Slash Commands 帮助（菜单项）
               *  行为：点击调 onOpenSlashCommand() 弹出 SlashCommandHelp 帮助面板
               *       集成 18 个内置命令（/plan /spec /review /init /status /help 等）
               *  图标：zap（闪电），表达命令输入 + 即时执行 */}
              {onOpenSlashCommand && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenSlashCommand)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-violet-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="zap" className="w-4 h-4 text-violet-500" />
                  <span>⚡ Slash Commands 帮助</span>
                </button>
              )}

              {/* v2.11.0 (Cycle 8 P0-14) 新增：Custom Models 管理（菜单项）
               *  行为：点击调 onOpenCustomModels() 弹出 CustomModelsPanel
               *       支持 OpenAI/Anthropic/Azure/Custom 四种 Provider
               *       集成 Bearer Token 自动刷新 + Fernet API Key 加密
               *  图标：brain-network（大脑+网络节点），表达多模型接入 */}
              {onOpenCustomModels && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenCustomModels)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-emerald-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="brain-network" className="w-4 h-4 text-emerald-500" />
                  <span>🧠 Custom Models 管理</span>
                </button>
              )}

              {/* v2.12.0 (Cycle 39 G39-03) 新增：MCP 服务器注册表（菜单项）
               *  行为：点击调 onOpenMcpRegistry() 弹出 McpRegistryPanel 服务器管理面板
               *       内置 5 个 MCP 服务器（filesystem / git / github / fetch / sqlite）
               *       支持连接/断开/工具调用/添加自定义服务器
               *  图标：plug（插头），表达外部工具/数据源接入 */}
              {onOpenMcpRegistry && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenMcpRegistry)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-violet-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="plug" className="w-4 h-4 text-violet-500" />
                  <span>🔌 MCP 服务器注册表</span>
                </button>
              )}

              {/* v2.21.0 (Cycle 41) 新增：MCP 高级能力（菜单项）
               *  行为：点击调 onOpenMcpAdvanced() 弹出 McpAdvancedPanel 高级能力面板
               *       包含 4 大高级能力：资源订阅 / 参数补全 / 服务器采样 / 根目录管理
               *       对应 MCP 2024-11-05 规范的 client 侧高级特性
               *  图标：zap（闪电），表达高性能协议能力 */}
              {onOpenMcpAdvanced && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenMcpAdvanced)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-yellow-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="zap" className="w-4 h-4 text-yellow-500" />
                  <span>⚡ MCP 高级能力</span>
                </button>
              )}

              {/* v6.36.0 (Cycle 16 P0-1) 新增：Composer 多文件编辑（菜单项）
               *  行为：点击调 onOpenComposer() 打开右侧 Composer 浮动面板
               *       支持 @file/@folder/@code/@docs/@web 上下文 + 多文件 diff 审查 + Undo/Redo
               *  图标：layers（堆叠图层），表达多文件协调编辑 */}
              {onOpenComposer && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenComposer)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-indigo-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="layers" className="w-4 h-4 text-indigo-500" />
                  <span>⚡ Composer 多文件编辑</span>
                </button>
              )}

              {/* v6.41.0 (Cycle 19 P0-1) 新增：后台任务面板（菜单项）
               *  行为：点击调 onOpenBackgroundTasks() 弹出 BackgroundTasksPanel
               *       支持任务创建/启动/暂停/恢复/取消/重试 + 状态过滤 + 实时统计
               *  图标：background-tasks（任务清单+勾选），表达后台异步执行 */}
              {onOpenBackgroundTasks && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenBackgroundTasks)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-orange-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="background-tasks" className="w-4 h-4 text-orange-500" />
                  <span>📋 后台任务</span>
                </button>
              )}

              {/* v6.42.0 (Cycle 19 P0-2) 新增：Best-of-N 多模型对比（菜单项）
               *  行为：点击调 onOpenBestOfN() 弹出 BestOfNPanel
               *       支持多模型并行调用 + 流式输出 + 实时成本计算 + 对比表
               *  图标：best-of-n（天平+刻度），表达多模型对比 */}
              {onOpenBestOfN && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenBestOfN)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-cyan-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="best-of-n" className="w-4 h-4 text-cyan-500" />
                  <span>⚖️ Best-of-N 多模型</span>
                </button>
              )}

              {/* v6.43.0 (Cycle 19 P0-3) 新增：Design Mode 设计模式（菜单项）
               *  行为：点击调 onOpenDesignMode() 激活 DesignModeOverlay
               *       支持元素悬停高亮 + 点击选择 + 框选 + 元素信息提取
               *  图标：design-mode（十字箭头+边框），表达框选与设计工具 */}
              {onOpenDesignMode && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenDesignMode)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-purple-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="design-mode" className="w-4 h-4 text-purple-500" />
                  <span>🎨 Design Mode 设计模式</span>
                </button>
              )}

              {/* v6.45.0 (Cycle 20 P0-1) 新增：Worktree 隔离管理（菜单项）
               *  行为：点击调 onOpenWorktree() 弹出 WorktreePanel
               *       支持 worktree 创建 / 合并 / 丢弃 / diff / cleanup
               *  图标：worktree（树形分支），表达 git worktree 隔离 */}
              {onOpenWorktree && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenWorktree)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-emerald-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="git-branch" className="w-4 h-4 text-emerald-500" />
                  <span>🌳 Worktree 隔离</span>
                </button>
              )}

              {/* v6.46.0 (Cycle 20 P0-2) 新增：智能模型路由（菜单项）
               *  行为：点击调 onOpenModelRouter() 弹出 ModelRouterPanel
               *       支持任务分类 + 复杂度评估 + 路由模式（cost/balance/intelligence）
               *  图标：cpu（CPU芯片），表达智能选择 */}
              {onOpenModelRouter && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenModelRouter)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-pink-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="cpu" className="w-4 h-4 text-pink-500" />
                  <span>🧠 智能模型路由</span>
                </button>
              )}

              {/* v6.47.0 (Cycle 20 P0-3) 新增：事件钩子管理（菜单项）
               *  行为：点击调 onOpenHooks20() 弹出 HooksPanel
               *       支持钩子注册（callback/webhook/command/script） + 触发 + 执行历史
               *  图标：zap（闪电），表达事件触发 */}
              {onOpenHooks20 && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenHooks20)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-amber-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="zap" className="w-4 h-4 text-amber-500" />
                  <span>🪝 事件钩子</span>
                </button>
              )}

              {/* v6.48.0 (Cycle 21 P0-1) 新增：Best-of-N × Worktree 协同（菜单项）
               *  行为：点击调 onOpenBestOfNCoordinator() 弹出 BestOfNCoordinatorPanel
               *       支持多模型并行 + worktree 隔离 + 候选对比 + 最佳应用
               *  图标：layers（堆叠），表达多模型协同 */}
              {onOpenBestOfNCoordinator && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenBestOfNCoordinator)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-indigo-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="layers" className="w-4 h-4 text-indigo-500" />
                  <span>🎯 Best-of-N 协同</span>
                </button>
              )}

              {/* v6.49.0 (Cycle 21 P0-2) 新增：模型路由成本统计 Dashboard（菜单项）
               *  行为：点击调 onOpenModelRouterStats() 弹出 ModelRouterStatsPanel
               *       支持总成本/模型排行/趋势分析/告警配置
               *  图标：chart（图表），表达数据统计 */}
              {onOpenModelRouterStats && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenModelRouterStats)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-rose-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="chart" className="w-4 h-4 text-rose-500" />
                  <span>💰 模型成本统计</span>
                </button>
              )}

              {/* v6.50.0 (Cycle 21 P0-4) 新增：Hook 模板市场（菜单项）
               *  行为：点击调 onOpenHooksMarketplace() 弹出 HooksMarketplacePanel
               *       支持预置模板浏览/搜索/安装/卸载
               *  图标：sparkles（星火），表达模板精选 */}
              {onOpenHooksMarketplace && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenHooksMarketplace)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-violet-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="sparkles" className="w-4 h-4 text-violet-500" />
                  <span>🛒 Hook 模板市场</span>
                </button>
              )}

              {/* v6.51.0 (Cycle 22 G22-01) 新增：Side Chat 多子对话（菜单项）
               *  行为：点击调 onOpenSideChat() 弹出 SideChatPanel
               *       支持在主对话之外开启轻量子对话，可晋升/合并/归档
               *  图标：side-chat（聊天气泡） */}
              {onOpenSideChat && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenSideChat)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-cyan-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="side-chat" className="w-4 h-4 text-cyan-500" />
                  <span>💬 Side Chat 多子对话</span>
                </button>
              )}

              {/* v6.52.0 (Cycle 22 G22-02) 新增：成本预测（菜单项）
               *  行为：点击调 onOpenCostPrediction() 弹出 CostPredictionPanel
               *       支持 4 种预测算法 + 预算设置 + 实时告警 + 趋势图表
               *  图标：predict（折线上箭头） */}
              {onOpenCostPrediction && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenCostPrediction)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-emerald-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="predict" className="w-4 h-4 text-emerald-500" />
                  <span>📈 成本预测</span>
                </button>
              )}

              {/* v6.53.0 (Cycle 22 G22-03) 新增：Hook 性能分析（菜单项）
               *  行为：点击调 onOpenHookPerformance() 弹出 HookPerformancePanel
               *       支持慢节点分析 + 失败率分析 + 5 类优化建议 + 报告导出
               *  图标：performance（时速表） */}
              {onOpenHookPerformance && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenHookPerformance)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-orange-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="performance" className="w-4 h-4 text-orange-500" />
                  <span>⚡ Hook 性能分析</span>
                </button>
              )}

              {/* v6.54.0 (Cycle 22 G22-04) 新增：模型路由管理（菜单项）
               *  行为：点击调 onOpenModelRouterAdmin() 弹出 ModelRouterAdminPanel
               *       支持团队策略 CRUD + 模型白/黑名单 + 显示控制 + 路由历史
               *  图标：admin（盾牌 + 勾） */}
              {onOpenModelRouterAdmin && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenModelRouterAdmin)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-sky-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="admin" className="w-4 h-4 text-sky-500" />
                  <span>🛡️ 模型路由管理</span>
                </button>
              )}

              {/* v6.55.0 (Cycle 23 G23-01) 新增：候选学习（菜单项）
               *  行为：点击调 onOpenCandidateLearning() 弹出 CandidateLearningPanel
               *       支持偏好画像/学习记录/反馈学习/模拟推荐
               *  图标：learning（大脑） */}
              {onOpenCandidateLearning && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenCandidateLearning)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-violet-50 flex items-center gap-2
                             transition-colors duration-fast"
                  data-testid="menu-candidate-learning"
                >
                  <Icon name="learning" className="w-4 h-4 text-violet-500" />
                  <span>🧠 候选学习</span>
                </button>
              )}

              {/* v6.56.0 (Cycle 23 G23-02) 新增：会话回放（菜单项）
               *  行为：点击调 onOpenSessionReplay() 弹出 SessionReplayPanel
               *       支持录制/回放/导出/分享
               *  图标：replay（快退箭头） */}
              {onOpenSessionReplay && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenSessionReplay)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-cyan-50 flex items-center gap-2
                             transition-colors duration-fast"
                  data-testid="menu-session-replay"
                >
                  <Icon name="replay" className="w-4 h-4 text-cyan-500" />
                  <span>⏮️ 会话回放</span>
                </button>
              )}

              {/* v6.57.0 (Cycle 23 G23-04) 新增：AI 主动建议（菜单项）
               *  行为：点击调 onOpenProactiveSuggestion() 弹出 ProactiveSuggestionPanel
               *       支持上下文分析/建议生成/智能去重/反馈学习
               *  图标：suggestion（灯泡） */}
              {onOpenProactiveSuggestion && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenProactiveSuggestion)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-amber-50 flex items-center gap-2
                             transition-colors duration-fast"
                  data-testid="menu-proactive-suggestion"
                >
                  <Icon name="suggestion" className="w-4 h-4 text-amber-500" />
                  <span>💡 AI 主动建议</span>
                </button>
              )}

              {/* v6.58.0 (Cycle 24 G24-01) 新增：全局记忆（菜单项）
               *  行为：点击调 onOpenGlobalMemory() 弹出 GlobalMemoryPanel
               *       支持跨会话持久化用户偏好/决策/事实/规则
               *  图标：brain（记忆） */}
              {onOpenGlobalMemory && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenGlobalMemory)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-emerald-50 flex items-center gap-2
                             transition-colors duration-fast"
                  data-testid="menu-global-memory"
                >
                  <Icon name="brain" className="w-4 h-4 text-emerald-500" />
                  <span>🧠 全局记忆</span>
                </button>
              )}

              {/* v6.59.0 (Cycle 24 G24-02) 新增：多任务并行编排（菜单项）
               *  行为：点击调 onOpenMultiTask() 弹出 MultiTaskOrchestrationPanel
               *       支持 5-10 个任务并行执行 + 依赖编排 + 冲突检测 + 预算控制
               *  图标：brain-network（神经网络） */}
              {onOpenMultiTask && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenMultiTask)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-blue-50 flex items-center gap-2
                             transition-colors duration-fast"
                  data-testid="menu-multi-task"
                >
                  <Icon name="brain-network" className="w-4 h-4 text-blue-500" />
                  <span>🧠 多任务编排</span>
                </button>
              )}

              {/* v6.60.0 (Cycle 24 G24-04) 新增：Figma 设计稿转代码（菜单项）
               *  行为：点击调 onOpenFigmaImport() 弹出 FigmaImportPanel
               *       URL 解析 + 节点拉取 + React/Vue/HTML 自动生成
               *  图标：figma（Figma logo 风格） */}
              {onOpenFigmaImport && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenFigmaImport)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-pink-50 flex items-center gap-2
                             transition-colors duration-fast"
                  data-testid="menu-figma-import"
                >
                  <Icon name="figma" className="w-4 h-4 text-pink-500" />
                  <span>🎨 Figma 转代码</span>
                </button>
              )}

              {/* v6.61.0 (Cycle 25 G25-01) 新增：自动化代码评审（菜单项）
               *  行为：点击调 onOpenAutoCodeReview() 弹出 AutoCodeReviewPanel
               *       100+ 内置规则 + 严重度分级 + JSON/Markdown/SARIF 导出
               *  图标：search-check（放大镜+对勾） */}
              {onOpenAutoCodeReview && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenAutoCodeReview)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-indigo-50 flex items-center gap-2
                             transition-colors duration-fast"
                  data-testid="menu-auto-code-review"
                >
                  <Icon name="search-check" className="w-4 h-4 text-indigo-500" />
                  <span>🔍 自动化代码评审</span>
                </button>
              )}

              {/* v6.62.0 (Cycle 25 G25-02) 新增：PR 自动机器人（菜单项）
               *  行为：点击调 onOpenPRBot() 弹出 PRBotPanel
               *       PR 事件触发 + 自动 review + 审计日志
               *  图标：bot（机器人） */}
              {onOpenPRBot && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenPRBot)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-cyan-50 flex items-center gap-2
                             transition-colors duration-fast"
                  data-testid="menu-pr-bot"
                >
                  <Icon name="bot" className="w-4 h-4 text-cyan-500" />
                  <span>🤖 PR 自动机器人</span>
                </button>
              )}

              {/* v6.63.0 (Cycle 25 G25-03) 新增：AI 性能优化器（菜单项）
               *  行为：点击调 onOpenPerfOptimizer() 弹出 PerfOptimizerPanel
               *       20+ 反模式规则 + 重构 diff + 性能预算检查
               *  图标：gauge（仪表盘） */}
              {onOpenPerfOptimizer && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenPerfOptimizer)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-amber-50 flex items-center gap-2
                             transition-colors duration-fast"
                  data-testid="menu-perf-optimizer"
                >
                  <Icon name="gauge" className="w-4 h-4 text-amber-500" />
                  <span>⚡ AI 性能优化器</span>
                </button>
              )}

              {/* v6.64.0 (Cycle 26 G26-01) 新增：CSV 批处理智能体（菜单项）
               *  行为：点击调 onOpenCsvBatch() 弹出 CsvBatchPanel
               *       支持 CSV 解析 + 模板渲染 + 并发任务调度 + 进度监控 + 结果导出
               *  图标：csv（表格+箭头） */}
              {onOpenCsvBatch && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenCsvBatch)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-emerald-50 flex items-center gap-2
                             transition-colors duration-fast"
                  data-testid="menu-csv-batch"
                >
                  <Icon name="csv" className="w-4 h-4 text-emerald-500" />
                  <span>📊 CSV 批处理</span>
                </button>
              )}

              {/* v6.65.0 (Cycle 26 G26-02) 新增：智能审批引擎（菜单项）
               *  行为：点击调 onOpenSmartApproval() 弹出 SmartApprovalPanel
               *       40+ 内置规则 + JSON DSL + 决策流 + 审计日志 + 人工覆盖
               *  图标：shield-alert（盾牌+警告） */}
              {onOpenSmartApproval && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenSmartApproval)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-rose-50 flex items-center gap-2
                             transition-colors duration-fast"
                  data-testid="menu-smart-approval"
                >
                  <Icon name="shield-alert" className="w-4 h-4 text-rose-500" />
                  <span>🛡️ 智能审批</span>
                </button>
              )}

              {/* v6.66.0 (Cycle 26 G26-03) 新增：MTC 多模任务协作（菜单项）
               *  行为：点击调 onOpenMTC() 弹出 MTCPanel
               *       7 种任务类型（总结/翻译/重写/分析/转换/提取/优化）+ 10 种文件类型
               *  图标：palette（调色板） */}
              {onOpenMTC && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenMTC)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-pink-50 flex items-center gap-2
                             transition-colors duration-fast"
                  data-testid="menu-mtc"
                >
                  <Icon name="palette" className="w-4 h-4 text-pink-500" />
                  <span>🎨 MTC 多模任务</span>
                </button>
              )}

              {/* v6.67.0 (Cycle 27 G27-01) 新增：嵌套子代理（菜单项）
               *  行为：点击调 onOpenNestedSubAgent() 弹出 NestedSubAgentPanel
               *       支持 3 层嵌套 + 树形视图 + 时间线 + 统计
               *  图标：nested（分层树形结构） */}
              {onOpenNestedSubAgent && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenNestedSubAgent)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-indigo-50 flex items-center gap-2
                             transition-colors duration-fast"
                  data-testid="menu-nested-sub-agent"
                >
                  <Icon name="nested" className="w-4 h-4 text-indigo-500" />
                  <span>🌲 嵌套子代理</span>
                </button>
              )}

              {/* v6.68.0 (Cycle 27 G27-02) 新增：代理检查点（菜单项）
               *  行为：点击调 onOpenAgentCheckpoint() 弹出 AgentCheckpointPanel
               *       支持检查点保存/恢复/重命名/标签/自动清理
               *  图标：checkpoint（书签/存档） */}
              {onOpenAgentCheckpoint && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenAgentCheckpoint)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-amber-50 flex items-center gap-2
                             transition-colors duration-fast"
                  data-testid="menu-agent-checkpoint"
                >
                  <Icon name="checkpoint" className="w-4 h-4 text-amber-500" />
                  <span>📌 代理检查点</span>
                </button>
              )}

              {/* v6.69.0 (Cycle 27 G27-04) 新增：代理消息（菜单项）
               *  行为：点击调 onOpenAgentMessaging() 弹出 AgentMessagingPanel
               *       支持 send_message/followup_task + 路径寻址 + 消息状态追踪
               *  图标：messaging（对话气泡） */}
              {onOpenAgentMessaging && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenAgentMessaging)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-cyan-50 flex items-center gap-2
                             transition-colors duration-fast"
                  data-testid="menu-agent-messaging"
                >
                  <Icon name="messaging" className="w-4 h-4 text-cyan-500" />
                  <span>💬 代理消息</span>
                </button>
              )}

              {/* v6.70.0 (Cycle 27 G27-05) 新增：代理模板（菜单项）
               *  行为：点击调 onOpenAgentTemplate() 弹出 AgentTemplatePanel
               *       10 个内置模板 + 5 个社区模板 + 用户自定义 + 评分
               *  图标：template（层叠卡片） */}
              {onOpenAgentTemplate && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenAgentTemplate)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-violet-50 flex items-center gap-2
                             transition-colors duration-fast"
                  data-testid="menu-agent-template"
                >
                  <Icon name="template" className="w-4 h-4 text-violet-500" />
                  <span>📋 代理模板</span>
                </button>
              )}

              {/* v6.71.0 (Cycle 27 G27-06) 新增：远程控制（菜单项）
               *  行为：点击调 onOpenRemoteControl() 弹出 RemoteControlPanel
               *       QR 配对 + Thread 迁移 + 远程命令 + 设备管理
               *  图标：remote（设备+信号） */}
              {onOpenRemoteControl && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenRemoteControl)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-emerald-50 flex items-center gap-2
                             transition-colors duration-fast"
                  data-testid="menu-remote-control"
                >
                  <Icon name="remote" className="w-4 h-4 text-emerald-500" />
                  <span>📱 远程控制</span>
                </button>
              )}

              {/* v6.72.0 (Cycle 28 G28-01) 新增：技能系统（菜单项） */}
              {onOpenSkillSystem && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenSkillSystem)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-rose-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-skill-system"
                >
                  <span>🎯 技能系统</span>
                </button>
              )}

              {/* v6.73.0 (Cycle 28 G28-02) 新增：成本预算（菜单项） */}
              {onOpenCostBudget && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenCostBudget)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-green-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-cost-budget"
                >
                  <span>💰 成本预算</span>
                </button>
              )}

              {/* v6.74.0 (Cycle 28 G28-03) 新增：用量归因（菜单项） */}
              {onOpenUsageAttribution && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenUsageAttribution)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-cyan-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-usage-attribution"
                >
                  <span>📊 用量归因</span>
                </button>
              )}

              {/* v6.75.0 (Cycle 28 G28-04) 新增：作用域权限（菜单项） */}
              {onOpenScopedPermissions && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenScopedPermissions)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-amber-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-scoped-permissions"
                >
                  <span>🔒 作用域权限</span>
                </button>
              )}

              {/* v6.76.0 (Cycle 28 G28-05) 新增：斜杠命令面板（菜单项） */}
              {onOpenCommandPalette && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenCommandPalette)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-violet-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-command-palette"
                >
                  <span>⌨️ 斜杠命令</span>
                </button>
              )}

              {/* v6.77.0 (Cycle 29 G29-01) 新增：堆叠技能（菜单项） */}
              {onOpenStackedSkills && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenStackedSkills)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-indigo-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-stacked-skills"
                >
                  <span>📚 堆叠技能</span>
                </button>
              )}

              {/* v6.78.0 (Cycle 29 G29-02) 新增：技能市场（菜单项） */}
              {onOpenSkillsMarket && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenSkillsMarket)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-pink-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-skills-market"
                >
                  <span>🛍️ 技能市场</span>
                </button>
              )}

              {/* v6.79.0 (Cycle 29 G29-03) 新增：分析聊天（菜单项） */}
              {onOpenAnalyticsChat && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenAnalyticsChat)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-teal-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-analytics-chat"
                >
                  <span>📊 分析聊天</span>
                </button>
              )}

              {/* v2.12.0 (Cycle 30) 新增：成本阈值告警（菜单项） */}
              {onOpenCostThreshold && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenCostThreshold)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-emerald-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-cost-threshold"
                >
                  <Icon name="cost-threshold" className="w-4 h-4" />
                  <span>💰 成本阈值告警</span>
                </button>
              )}

              {/* v2.12.0 (Cycle 30) 新增：动态工作流（菜单项） */}
              {onOpenDynamicWorkflow && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenDynamicWorkflow)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-cyan-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-dynamic-workflow"
                >
                  <Icon name="workflow" className="w-4 h-4" />
                  <span>⚙️ 动态工作流</span>
                </button>
              )}

              {/* v2.12.0 (Cycle 30) 新增：编排多代理（菜单项） */}
              {onOpenOrchestratedAgent && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenOrchestratedAgent)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-violet-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-orchestrated-agent"
                >
                  <Icon name="orchestrate" className="w-4 h-4" />
                  <span>🎼 编排多代理</span>
                </button>
              )}

              {/* v2.13.0 (Cycle 31) 新增：成本归因（菜单项） */}
              {onOpenCostAttribution && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenCostAttribution)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-amber-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-cost-attribution"
                >
                  <Icon name="attribution" className="w-4 h-4" />
                  <span>📊 成本归因</span>
                </button>
              )}

              {/* v2.13.0 (Cycle 31) 新增：远程 Worktree（菜单项） */}
              {onOpenRemoteWorktree && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenRemoteWorktree)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-sky-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-remote-worktree"
                >
                  <Icon name="cloud" className="w-4 h-4" />
                  <span>☁️ 远程 Worktree</span>
                </button>
              )}

              {/* v2.13.0 (Cycle 31) 新增：Worktree 状态同步（菜单项） */}
              {onOpenWorktreeSync && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenWorktreeSync)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-indigo-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-worktree-sync"
                >
                  <Icon name="sync" className="w-4 h-4" />
                  <span>🔄 状态同步</span>
                </button>
              )}

              {/* v2.14.0 (Cycle 32 G32-01) 新增：审计追踪（菜单项） */}
              {onOpenAuditTrail && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenAuditTrail)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-rose-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-audit-trail"
                >
                  <Icon name="audit" className="w-4 h-4 text-rose-500" />
                  <span>🛡️ 审计追踪</span>
                </button>
              )}

              {/* v2.14.0 (Cycle 32 G32-02) 新增：单点登录（菜单项） */}
              {onOpenSSO && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenSSO)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-indigo-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-sso"
                >
                  <Icon name="sso" className="w-4 h-4 text-indigo-500" />
                  <span>🔐 单点登录</span>
                </button>
              )}

              {/* v2.14.0 (Cycle 32 G32-03) 新增：策略规则（菜单项） */}
              {onOpenPolicy && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenPolicy)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-fuchsia-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-policy"
                >
                  <Icon name="policy" className="w-4 h-4 text-fuchsia-500" />
                  <span>📋 策略规则</span>
                </button>
              )}

              {/* v2.15.0 (Cycle 33 G33-01) 新增：企业全场景工作流（菜单项） */}
              {onOpenEnterpriseWorkflow && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenEnterpriseWorkflow)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-cyan-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-enterprise-workflow"
                >
                  <Icon name="enterprise-workflow" className="w-4 h-4 text-cyan-500" />
                  <span>🔄 企业工作流</span>
                </button>
              )}

              {/* v2.15.0 (Cycle 33 G33-02) 新增：集成 Dashboard（菜单项） */}
              {onOpenUnifiedDashboard && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenUnifiedDashboard)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-violet-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-unified-dashboard"
                >
                  <Icon name="unified-dashboard" className="w-4 h-4 text-violet-500" />
                  <span>📊 集成 Dashboard</span>
                </button>
              )}

              {/* v2.15.0 (Cycle 33 G33-03) 新增：安全审计（菜单项） */}
              {onOpenSecurityAudit && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenSecurityAudit)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-red-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-security-audit"
                >
                  <Icon name="security-shield" className="w-4 h-4 text-red-500" />
                  <span>🛡 安全审计</span>
                </button>
              )}

              {/* v2.16.0 (Cycle 34 G34-01) 新增：端云模型路由（菜单项） */}
              {onOpenEdgeModelRouter && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenEdgeModelRouter)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-sky-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-edge-model-router"
                >
                  <Icon name="edge-cloud" className="w-4 h-4 text-sky-500" />
                  <span>☁ 端云路由</span>
                </button>
              )}

              {/* v2.16.0 (Cycle 34 G34-02) 新增：离线优先（菜单项） */}
              {onOpenOfflineFirst && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenOfflineFirst)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-amber-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-offline-first"
                >
                  <Icon name="offline" className="w-4 h-4 text-amber-500" />
                  <span>📴 离线优先</span>
                </button>
              )}

              {/* v2.16.0 (Cycle 34 G34-03) 新增：设备集群（菜单项） */}
              {onOpenDeviceCluster && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenDeviceCluster)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-indigo-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-device-cluster"
                >
                  <Icon name="devices" className="w-4 h-4 text-indigo-500" />
                  <span>📱 设备集群</span>
                </button>
              )}

              {/* v2.18.0 (Cycle 35 G35-01) 新增：工作流编排（菜单项） */}
              {onOpenWorkflowOrchestrator && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenWorkflowOrchestrator)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-blue-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-workflow-orchestrator"
                >
                  <Icon name="workflow" className="w-4 h-4 text-blue-500" />
                  <span>🔀 工作流编排</span>
                </button>
              )}

              {/* v2.18.0 (Cycle 35 G35-02) 新增：智能体通信（菜单项） */}
              {onOpenAgentCommunication && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenAgentCommunication)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-purple-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-agent-communication"
                >
                  <Icon name="chat" className="w-4 h-4 text-purple-500" />
                  <span>💬 智能体通信</span>
                </button>
              )}

              {/* v2.18.0 (Cycle 35 G35-03) 新增：任务检查点（菜单项） */}
              {onOpenTaskCheckpoint && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenTaskCheckpoint)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-green-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-task-checkpoint"
                >
                  <Icon name="checkpoint" className="w-4 h-4 text-green-500" />
                  <span>📸 任务检查点</span>
                </button>
              )}

              {/* v2.18.0 (Cycle 35 G35-04) 新增：智能体调度（菜单项） */}
              {onOpenAgentScheduler && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenAgentScheduler)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-rose-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-agent-scheduler"
                >
                  <Icon name="scheduler" className="w-4 h-4 text-rose-500" />
                  <span>⚡ 智能体调度</span>
                </button>
              )}

              {/* v2.18.0 (Cycle 36 G36-01) 新增：LLM Provider 管理（菜单项） */}
              {onOpenLLMProvider && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenLLMProvider)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-indigo-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-llm-provider"
                >
                  <Icon name="llm" className="w-4 h-4 text-indigo-500" />
                  <span>🧠 LLM Provider</span>
                </button>
              )}

              {/* v2.18.0 (Cycle 36 G36-02) 新增：流式对话演示（菜单项） */}
              {onOpenStreamingChat && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenStreamingChat)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-cyan-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-streaming-chat"
                >
                  <Icon name="stream" className="w-4 h-4 text-cyan-500" />
                  <span>💬 流式对话</span>
                </button>
              )}

              {/* v2.18.0 (Cycle 36 G36-03) 新增：多模态处理（菜单项） */}
              {onOpenMultiModal && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenMultiModal)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-pink-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-multimodal"
                >
                  <Icon name="multimodal" className="w-4 h-4 text-pink-500" />
                  <span>🖼️ 多模态处理</span>
                </button>
              )}

              {/* v2.19.0 (Cycle 37 G37-01) 新增：RAG 知识库（菜单项） */}
              {onOpenRAG && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenRAG)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-amber-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-rag"
                >
                  <Icon name="rag" className="w-4 h-4 text-amber-500" />
                  <span>📚 RAG 知识库</span>
                </button>
              )}

              {/* v2.19.0 (Cycle 37 G37-02) 新增：Tool Use 工具市场（菜单项） */}
              {onOpenToolMarketplace && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenToolMarketplace)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-emerald-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-tool-marketplace"
                >
                  <Icon name="tool" className="w-4 h-4 text-emerald-500" />
                  <span>🔧 工具市场</span>
                </button>
              )}

              {/* v2.19.0 (Cycle 37 G37-03) 新增：Agent Loop 智能体循环（菜单项） */}
              {onOpenAgentLoop && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenAgentLoop)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-violet-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-agent-loop"
                >
                  <Icon name="loop" className="w-4 h-4 text-violet-500" />
                  <span>🔄 Agent Loop</span>
                </button>
              )}

              {/* v2.19.0 (Cycle 37 G37-04) 新增：真实 LLM Provider 配置（菜单项） */}
              {onOpenRealLLMProvider && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenRealLLMProvider)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-sky-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-real-llm-provider"
                >
                  <Icon name="real-llm" className="w-4 h-4 text-sky-500" />
                  <span>☁️ 真实 LLM</span>
                </button>
              )}

              {/* v2.20.0 (Cycle 38 G38-01) 新增：多 Agent 协作（菜单项） */}
              {onOpenMultiAgentCrew && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenMultiAgentCrew)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-indigo-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-multi-agent-crew"
                >
                  <Icon name="multi-agent" className="w-4 h-4 text-indigo-500" />
                  <span>👥 多 Agent 协作</span>
                </button>
              )}

              {/* v2.20.0 (Cycle 38 G38-02) 新增：长期记忆管理（菜单项） */}
              {onOpenLongTermMemory && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenLongTermMemory)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-cyan-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-long-term-memory"
                >
                  <Icon name="memory" className="w-4 h-4 text-cyan-500" />
                  <span>🧠 长期记忆</span>
                </button>
              )}

              {/* v2.20.0 (Cycle 38 G38-03) 新增：反思与自我修正（菜单项） */}
              {onOpenReflection && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenReflection)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-fuchsia-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-reflection"
                >
                  <Icon name="reflection" className="w-4 h-4 text-fuchsia-500" />
                  <span>🔁 反思迭代</span>
                </button>
              )}

              {/* v2.20.0 (Cycle 38 G38-04) 新增：人机协作审批（菜单项） */}
              {onOpenHumanApproval && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenHumanApproval)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700 hover:bg-rose-50 flex items-center gap-2 transition-colors duration-fast"
                  data-testid="menu-human-approval"
                >
                  <Icon name="approval" className="w-4 h-4 text-rose-500" />
                  <span>✅ 审批中心</span>
                </button>
              )}

              {/* 用量监控 */}
              {onOpenUsage && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenUsage)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="chart" className="w-4 h-4" />
                  <span>用量监控</span>
                </button>
              )}

              {/* 设置 */}
              {onOpenSettings && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenSettings)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="settings" className="w-4 h-4" />
                  <span>设置</span>
                </button>
              )}

              {/* 回收站 */}
              {onOpenTrash && (
                <button
                  role="menuitem"
                  onClick={wrapMenuItem(onOpenTrash)}
                  className="w-full px-4 py-2 text-left text-sm text-surface-700
                             hover:bg-surface-50 flex items-center gap-2
                             transition-colors duration-fast"
                >
                  <Icon name="trash" className="w-4 h-4" />
                  <span>回收站</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
