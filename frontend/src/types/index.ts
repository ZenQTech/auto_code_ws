/**
 * # ============================================================
 * # 前端类型定义
 * # ============================================================
 * # 核心作用：定义前端所有数据结构的 TypeScript 类型
 * # ============================================================
 * # 修改记录：
 * #   - 2026-06-17 | v1.0.0 | 初始版本，定义 Agent / Task / Conversation / StatsOverview / WSMessage / UsageOverview
 * #   - 2026-06-23 | v1.1.0 | 补充 Optim 化结果 / 任务计划 / 子任务 等扩展类型
 * #   - 2026-06-23 | v1.2.0 | 新增 Session / Message / SessionDetail 类型；Conversation 扩展 session_id
 * #   - 2026-06-24 | v1.3.0 | 新增 QuotaOverview / ArchitectureStatus / EvaluationReport / GitStatus / MemorySearchResult / MemoryStats / SecurityReview / ArchitectureDesign / ArchitectureCritique / TaskTreeNode / ConfigSection 等调度平台 V4.1 类型
 * #   - 2026-06-24 | v1.4.0 | SessionStatus 新增 'deleted'；Session 接口新增 deleted_at 可选字段（回收站功能支持）
 * #   - 2026-06-24 | v1.5.0 | Message 接口新增 error 可选字段（流式错误态支持，兼容旧数据）
 * #   - 2026-06-24 | v1.6.0 | Session 接口新增 mode 字段（'chat' | 'coding'，双模式入口支持）
 * #   - 2026-06-25 | v1.7.0 | 新增 StageDetail / LoopWorkflowStage / LoopWorkflowStatus 接口（工作流仪表盘与阶段查看器类型支持）
 * #   - 2026-06-30 | v1.8.0 | Session 接口新增 workflow_id / workflow_stage 可选字段（clarifying 阶段分流：前端据此拉取工作流状态）
 * # ============================================================
 */

/** 智能体状态 */
export type AgentStatus = 'online' | 'busy' | 'offline' | 'error';

/** 任务状态 */
export type TaskStatus = 'pending' | 'running' | 'validating' | 'completed' | 'failed' | 'cancelled';

/** 任务优先级 */
export type TaskPriority = 'high' | 'medium' | 'low';

/** 执行模式 */
export type ExecutionMode = 'direct' | 'subagent' | 'agent_team';

/** 智能体信息 */
export interface Agent {
  id: string;
  name: string;
  avatar_seed: string;
  status: AgentStatus;
  cli_path: string;
  workspace: string;
  /** v4.3.0 P2-1 新增：Git 分支名（SubAgent 独立工作区） */
  branch_name?: string;
  /** v4.3.0 P2-1 新增：Worktree 唯一 ID */
  worktree_id?: string;
  /** v4.3.0 P2-1 新增：当前处理的模块名 */
  module_name?: string;
  /** v4.3.0 P2-1 新增：workspace 内文件数 */
  file_count?: number;
  /** v4.3.0 P2-1 新增：workspace 提交数 */
  commit_count?: number;
  /** v4.3.0 P2-1 新增：当前任务进度 0-100 */
  progress_percent?: number;
  max_concurrent: number;
  current_tasks: number;
  total_tokens: number;
  total_api_calls: number;
}

/** 任务信息 */
export interface Task {
  id: string;
  agent_id: string | null;
  parent_task_id: string | null;
  title: string;
  description: string;
  original_prompt: string;
  optimized_prompt: string;
  status: TaskStatus;
  priority: TaskPriority;
  execution_mode: ExecutionMode;
  complexity_score: number;
  iteration_count: number;
  max_iterations: number;
  result_summary: string;
  error_message: string;
  token_consumed: number;
  api_calls: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

/** 对话记录 */
export interface Conversation {
  id: string;
  task_id: string | null;
  agent_id: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  /** 所属会话 ID（v1.2.0 新增） */
  session_id: string | null;
}

/** 子任务 */
export interface SubTask {
  id: number;
  title: string;
  description: string;
  priority: TaskPriority;
  dependencies: number[];
  estimated_complexity: number;
}

/** 优化结果 */
export interface OptimizeResult {
  original: string;
  optimized: string;
  task_modules: string[];
  constraints: string[];
  success: boolean;
  error_message: string;
}

/** 任务计划 */
export interface TaskPlan {
  sub_tasks: SubTask[];
  total_tasks: number;
  success: boolean;
  error_message: string;
}

/** 统计概览 */
export interface StatsOverview {
  agents: {
    total: number;
    online: number;
    busy: number;
    offline: number;
  };
  tasks: {
    total: number;
    completed: number;
    failed: number;
    running: number;
    completion_rate: number;
  };
  resources: {
    total_tokens: number;
    total_api_calls: number;
  };
}

/** WebSocket 消息 */
export interface WSMessage {
  type: string;
  [key: string]: unknown;
}

/** 用量概览数据 */
export interface UsageOverview {
  recent_5h_api_calls: number;
  remaining_calls: number;
  total_tokens: number;
  is_local: boolean;
}

// ============================================================
// Session 相关类型（v1.2.0 新增）
// 核心作用：定义"会话（Session）"作为顶层数据组织单元，
//           每个 Session 聚合 Hermes 主对话 / 子 Agent / 子 Task / 历史 Conversation
// ============================================================

/** 会话状态：active=活跃；archived=归档；deleted=已删除（回收站） */
export type SessionStatus = 'active' | 'archived' | 'deleted';

/** 会话元数据 */
export interface Session {
  /** 会话唯一标识（UUID） */
  id: string;
  /** 会话标题（默认截取首条用户消息前 30 字） */
  title: string;
  /** 创建时间（ISO 字符串） */
  created_at: string;
  /** 最近活跃时间（ISO 字符串） */
  last_active_at: string;
  /** 首条用户消息全文（用于侧边栏副标题兜底展示） */
  user_first_message: string;
  /** 消息条数缓存（避免每次 list 重新统计 conversations） */
  message_count: number;
  /** 会话状态 */
  status: SessionStatus;
  /** 删除时间（ISO 字符串），仅在 status='deleted' 时有值 */
  deleted_at?: string;
  /** 会话模式：chat=日常办公闲聊，coding=编程模式（v1.6.0 新增） */
  mode: 'chat' | 'coding';
  /** 关联的工作流 ID（v1.8.0 新增）：仅 coding 模式触发 SOP 工作流后有值，否则为 null/undefined */
  workflow_id?: string | null;
  /** 当前工作流阶段（v1.8.0 新增）：如 'clarifying'，仅工作流进行中有值，否则为 null/undefined */
  workflow_stage?: string | null;
}

/** 单条消息（含 thinking / text 区分） */
export interface Message {
  id: string;
  /** 消息角色：user=用户；assistant=Hermes/CLI；system=系统 */
  role: 'user' | 'assistant' | 'system';
  /** 消息正文（thinking 不混入此处） */
  content: string;
  /** 思考过程内容（仅 assistant 角色有值） */
  thinking?: string;
  /** 流式错误信息（v1.5.0 新增）；非空时表示该消息处理失败，前端展示 error-card */
  error?: string;
  /** 创建时间（ISO 字符串） */
  created_at: string;
  /** 所属会话 ID */
  session_id: string;
  /** 关联智能体 ID（仅 CLI 实例产生的消息有值） */
  agent_id: string | null;
  /** 关联任务 ID */
  task_id: string | null;
}

/** 会话详情聚合（一次响应即可恢复完整上下文） */
export interface SessionDetail {
  /** 会话元数据 */
  session: Session;
  /** 该 Session 的 Hermes 主对话列表（按 created_at 升序） */
  messages: Message[];
  /** 该 Session 下所有 Claude Code CLI 子实例 */
  agents: Agent[];
  /** 该 Session 下所有子任务 */
  tasks: Task[];
  /** 完整对话记录（含 user / assistant / system） */
  conversations: Conversation[];
}

// ============================================================
// 调度平台 V4.1 新增类型（v1.3.0 新增）
// 核心作用：定义配额监控 / 架构设计 / 评测报告 / Git 管理 /
//           记忆库 / 安全审查 / 任务树 / 配置中心等新模块类型
// ============================================================

/** 告警级别 */
export type AlertLevel = 'green' | 'yellow' | 'orange' | 'red';

/** 工作流阶段状态 */
export type StageStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/** 风险等级 */
export type RiskLevel = '极高' | '高' | '一般' | '低';

/** 安全审查项状态 */
export type SecurityCheckStatus = 'pass' | 'fail' | 'pending';

/** 评测结论 */
export type EvaluationConclusion = 'pass' | 'fail' | 'conditional_pass';

/** 缺陷严重程度 */
export type DefectSeverity = 'critical' | 'major' | 'minor' | 'suggestion';

// ============================================================
// 配额监控相关类型
// ============================================================

/** 单个时间维度的配额用量 */
export interface QuotaDimension {
  /** 维度名称：5h / week / month */
  label: string;
  /** 已用配额 */
  used: number;
  /** 总配额上限 */
  total: number;
  /** 使用百分比（0-100） */
  percentage: number;
}

/** 配额监控概览 */
export interface QuotaOverview {
  /** 三个时间维度的配额用量 */
  dimensions: QuotaDimension[];
  /** 当前告警级别 */
  alert_level: AlertLevel;
  /** 最大并行任务数 */
  max_parallel_tasks: number;
  /** 当前并行任务数 */
  current_parallel_tasks: number;
  /** 每分钟最大调用次数 */
  max_calls_per_minute: number;
  /** 当前每分钟调用次数 */
  current_calls_per_minute: number;
  /** 输入 Token 总量 */
  total_input_tokens: number;
  /** 输出 Token 总量 */
  total_output_tokens: number;
  /** 数据更新时间（ISO 字符串） */
  updated_at: string;
}

// ============================================================
// 架构设计相关类型
// ============================================================

/** 架构设计工作流状态 */
export interface ArchitectureStatus {
  /** 当前迭代次数 */
  current_iteration: number;
  /** 最大迭代次数 */
  max_iterations: number;
  /** 当前阶段状态 */
  status: StageStatus;
  /** 是否需要人工审核 */
  needs_human_review: boolean;
  /** 审核节点名称 */
  review_node: string;
  /** 最后更新时间（ISO 字符串） */
  updated_at: string;
}

/** 架构设计文档 */
export interface ArchitectureDesign {
  /** 设计文档 Markdown 内容 */
  content: string;
  /** 版本号 */
  version: string;
  /** 创建时间（ISO 字符串） */
  created_at: string;
}

/** 架构审查缺陷 */
export interface ArchitectureCritiqueItem {
  /** 缺陷唯一标识 */
  id: string;
  /** 缺陷标题 */
  title: string;
  /** 缺陷描述 */
  description: string;
  /** 严重程度 */
  severity: DefectSeverity;
  /** 所在章节 */
  section: string;
  /** 建议修复方案 */
  suggestion: string;
}

/** 架构审查结果 */
export interface ArchitectureCritique {
  /** 缺陷列表 */
  defects: ArchitectureCritiqueItem[];
  /** 是否通过审查 */
  passed: boolean;
  /** 审查时间（ISO 字符串） */
  reviewed_at: string;
}

// ============================================================
// 评测报告相关类型
// ============================================================

/** 评测报告章节 */
export interface EvaluationChapter {
  /** 章节编号（1-8） */
  index: number;
  /** 章节标题 */
  title: string;
  /** 章节内容（Markdown） */
  content: string;
  /** 章节评测结论 */
  conclusion: EvaluationConclusion;
}

/** 评测问题项 */
export interface EvaluationIssue {
  /** 问题唯一标识 */
  id: string;
  /** 问题标题 */
  title: string;
  /** 问题描述 */
  description: string;
  /** 严重程度 */
  severity: DefectSeverity;
  /** 所属章节 */
  chapter: number;
  /** 建议修复方案 */
  suggestion: string;
}

/** 评测报告 */
export interface EvaluationReport {
  /** 报告类型：architecture / code / integration / security */
  type: string;
  /** 总体结论 */
  conclusion: EvaluationConclusion;
  /** 各章节评测结果 */
  chapters: EvaluationChapter[];
  /** 问题列表 */
  issues: EvaluationIssue[];
  /** 总评分（0-100） */
  score: number;
  /** 生成时间（ISO 字符串） */
  generated_at: string;
}

// ============================================================
// Git 管理相关类型
// ============================================================

/** Git 仓库状态 */
export interface GitStatus {
  /** 当前分支名 */
  branch: string;
  /** 仓库是否干净（无未提交变更） */
  clean: boolean;
  /** 未暂存变更文件数 */
  unstaged_changes: number;
  /** 已暂存变更文件数 */
  staged_changes: number;
  /** 未跟踪文件数 */
  untracked_files: number;
  /** 与远程的提交差异（超前/落后） */
  ahead: number;
  /** 与远程的提交差异（落后） */
  behind: number;
  /** 最新标签 */
  latest_tag: string | null;
}

/** Git 提交记录 */
export interface GitCommit {
  /** 提交哈希（短） */
  hash: string;
  /** 提交信息 */
  message: string;
  /** 作者 */
  author: string;
  /** 提交时间（ISO 字符串） */
  date: string;
}

/** Git 分支信息 */
export interface GitBranch {
  /** 分支名称 */
  name: string;
  /** 是否为当前分支 */
  current: boolean;
  /** 最后提交信息 */
  last_commit: string;
  /** 最后提交时间（ISO 字符串） */
  last_commit_date: string;
}

// ============================================================
// 记忆库相关类型
// ============================================================

/** 记忆库搜索结果 */
export interface MemorySearchResult {
  /** 结果唯一标识 */
  id: string;
  /** 代码片段标题 */
  title: string;
  /** 代码片段内容 */
  content: string;
  /** 相似度评分（0-1） */
  similarity: number;
  /** 编程语言 */
  language: string;
  /** 标签列表 */
  tags: string[];
  /** 入库时间（ISO 字符串） */
  created_at: string;
}

/** 记忆库统计信息 */
export interface MemoryStats {
  /** 总代码片段数 */
  total_snippets: number;
  /** 总标签数 */
  total_tags: number;
  /** 各语言片段数分布 */
  language_distribution: Record<string, number>;
  /** 最近入库时间（ISO 字符串） */
  last_updated: string;
  /** 总存储大小（字节） */
  total_size_bytes: number;
}

// ============================================================
// 安全审查相关类型
// ============================================================

/** 安全审查检查项 */
export interface SecurityCheckItem {
  /** 检查项唯一标识 */
  id: string;
  /** 检查项名称 */
  name: string;
  /** 检查项描述 */
  description: string;
  /** 检查结果 */
  status: SecurityCheckStatus;
  /** 检查详情 */
  detail: string;
  /** 所属分类 */
  category: string;
}

/** 安全审查记录 */
export interface SecurityReview {
  /** 审查记录唯一标识 */
  id: string;
  /** 审查迭代次数 */
  iteration: number;
  /** 审查状态 */
  status: StageStatus;
  /** 检查项列表 */
  checklist: SecurityCheckItem[];
  /** 是否全部通过 */
  all_passed: boolean;
  /** 审查时间（ISO 字符串） */
  reviewed_at: string;
  /** 审查人 */
  reviewer: string;
}

// ============================================================
// 任务树相关类型
// ============================================================

/** 任务树节点 */
export interface TaskTreeNode {
  /** 任务唯一标识 */
  id: string;
  /** 任务标题 */
  title: string;
  /** 任务描述 */
  description: string;
  /** 任务状态 */
  status: TaskStatus;
  /** 优先级 */
  priority: TaskPriority;
  /** 风险等级 */
  risk_level: RiskLevel;
  /** 复杂度评分 */
  complexity_score: number;
  /** 子任务列表 */
  children: TaskTreeNode[];
  /** 依赖任务 ID 列表 */
  dependencies: string[];
  /** 全局接口规范引用 */
  interface_spec_ref: string;
}

// ============================================================
// 配置中心相关类型
// ============================================================

/** 配置项 */
export interface ConfigItem {
  /** 配置键名 */
  key: string;
  /** 配置值 */
  value: string | number | boolean;
  /** 配置描述 */
  description: string;
  /** 默认值 */
  default_value: string | number | boolean;
  /** 取值范围说明 */
  range: string;
}

/** 配置分组 */
export interface ConfigSection {
  /** 分组名称 */
  name: string;
  /** 分组标识 */
  key: string;
  /** 配置项列表 */
  items: ConfigItem[];
}

// ============================================================
// 工作流仪表盘相关类型
// ============================================================

/** 工作流阶段 */
export interface WorkflowStage {
  /** 阶段标识 */
  key: string;
  /** 阶段名称 */
  name: string;
  /** 阶段状态 */
  status: StageStatus;
  /** 阶段描述 */
  description: string;
  /** 开始时间（ISO 字符串） */
  started_at: string | null;
  /** 完成时间（ISO 字符串） */
  completed_at: string | null;
}

/** 工作流整体状态 */
export interface WorkflowStatus {
  /** 阶段列表 */
  stages: WorkflowStage[];
  /** 整体进度百分比（0-100） */
  progress: number;
  /** 当前阶段索引 */
  current_stage_index: number;
}

/** 阶段详情（v1.7.0 新增）
 *  核心作用：描述单个工作流阶段的完整信息，
 *            包括阶段名称、状态、智能体角色、时间、输出文档、对话摘要 */
export interface StageDetail {
  /** 阶段名称 */
  stage_name: string;
  /** 阶段状态 */
  status: string;
  /** 智能体角色（可选） */
  agent_role?: string;
  /** 开始时间（ISO 字符串，可选） */
  started_at?: string | null;
  /** 完成时间（ISO 字符串，可选） */
  completed_at?: string | null;
  /** 输出文档内容（可选） */
  output_doc?: string;
  /** 智能体对话摘要（可选） */
  conversation_summary?: string;
}

/** Loop 工作流阶段（v1.7.0 新增）
 *  核心作用：描述 Loop Engineering 工作流中单个阶段的状态，
 *            包括阶段标识、名称、状态、智能体角色、时间 */
export interface LoopWorkflowStage {
  /** 阶段标识 */
  key: string;
  /** 阶段名称 */
  name: string;
  /** 阶段状态 */
  status: StageStatus;
  /** 智能体角色（可选） */
  agent_role?: string;
  /** 开始时间（ISO 字符串，可选） */
  started_at?: string;
  /** 完成时间（ISO 字符串，可选） */
  completed_at?: string;
}

/** Loop 工作流状态（v1.7.0 新增）
 *  核心作用：描述 Loop Engineering 工作流的整体运行状态，
 *            包括阶段列表、整体进度、迭代计数与错误信息 */
export interface LoopWorkflowStatus {
  /** 工作流唯一标识 */
  workflow_id: string;
  /** 关联会话 ID */
  session_id: string;
  /** 工作流状态 */
  status: string;
  /** 当前阶段标识 */
  current_stage: string;
  /** 阶段列表 */
  stages: LoopWorkflowStage[];
  /** 整体进度百分比（0-100） */
  progress: number;
  /** 当前迭代次数 */
  iteration_count: number;
  /** 最大迭代次数 */
  max_iterations: number;
  /** 错误信息（可选） */
  error_message?: string;
}

// ============================================================
// 人工审核提醒相关类型
// ============================================================

/** 人工审核节点 */
export interface HumanReviewNode {
  /** 节点唯一标识 */
  id: string;
  /** 节点名称 */
  name: string;
  /** 审核截止时间（ISO 字符串） */
  deadline: string;
  /** 审核类型 */
  type: string;
  /** 关联任务 ID */
  task_id: string;
  /** 剩余秒数 */
  remaining_seconds: number;
}

// ============================================================
// 文件资源管理器相关类型（v2.10.0 新增）
// 核心作用：定义项目、文件树、文件内容等数据结构
// ============================================================

/** 项目信息 */
export interface Project {
  /** 项目名称 */
  name: string;
  /** 项目路径 */
  path: string;
  /** 文件数量 */
  file_count: number;
}

/** 文件树节点 */
export interface FileTreeNode {
  /** 节点名称 */
  name: string;
  /** 节点路径 */
  path: string;
  /** 节点类型：file=文件，directory=目录 */
  type: 'file' | 'directory';
  /** 子节点（仅目录有值） */
  children?: FileTreeNode[];
  /** 文件扩展名（仅文件有值） */
  extension?: string;
}

/** 文件内容 */
export interface FileContent {
  /** 文件路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 文件扩展名 */
  extension: string;
  /** 文件内容 */
  content: string;
  /** 行数 */
  lines: number;
  /** 是否可预览 */
  previewable: boolean;
}

// ============================================================
// Loop Engineering 工作流前端展示组件类型（v1.9.0 新增）
// 核心作用：定义 ReviewReport / PipelineProgress / GoalProgress
//           三个组件的 Props 数据类型
// ============================================================

/** 评审数据（ReviewReport 组件 Props） */
export interface ReviewData {
  /** 总评分（0-100） */
  overall_score: number;
  /** 各维度评分：correctness / security / standards / completeness 等 */
  dimension_scores: Record<string, number>;
  /** 缺陷列表 */
  defects: DefectItem[];
  /** 是否通过评审 */
  passed: boolean;
  /** 评审总结文本 */
  summary: string;
}

/** 评审缺陷项 */
export interface DefectItem {
  /** 缺陷唯一标识 */
  defect_id: string;
  /** 严重程度：critical=致命 / major=严重 / minor=轻微 */
  severity: 'critical' | 'major' | 'minor';
  /** 所属维度 */
  dimension: string;
  /** 缺陷位置（文件路径或代码位置） */
  location: string;
  /** 缺陷描述 */
  description: string;
  /** 影响范围 */
  impact_scope: string;
  /** 修复建议 */
  repair_plan: string;
}

/** 流水线步骤数据 */
export interface PipelineStepData {
  /** 步骤名称 */
  step_name: string;
  /** 步骤状态：running=运行中 / completed=已完成 / failed=失败 / pending=待执行 */
  status: 'running' | 'completed' | 'failed' | 'pending';
  /** 开始时间（ISO 字符串） */
  started_at?: string;
  /** 完成时间（ISO 字符串） */
  completed_at?: string;
  /** 输出结果文本 */
  output?: string;
  /** 错误信息 */
  error?: string;
}

/** 全链路流水线数据（PipelineProgress 组件 Props） */
export interface PipelineData {
  /** 工作流唯一标识 */
  workflow_id: string;
  /** 整体状态：running=运行中 / completed=已完成 / failed=失败 */
  overall_status: 'running' | 'completed' | 'failed';
  /** 步骤列表 */
  steps: PipelineStepData[];
  /** 所有模块是否通过 */
  all_modules_passed: boolean;
  /** Git 提交是否成功 */
  git_commit_success: boolean;
  /** 集成测试是否通过 */
  integration_test_passed: boolean;
  /** 流水线总结文本 */
  summary: string;
}

/** 子目标数据 */
export interface SubGoalData {
  /** 子目标唯一标识 */
  id: string;
  /** 子目标名称 */
  name: string;
  /** 子目标描述 */
  description: string;
  /** 子目标状态：pending=待执行 / in_progress=执行中 / completed=已完成 / failed=失败 */
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  /** 所属模块名称 */
  module_name: string;
  /** 依赖的子目标 ID 列表 */
  dependencies: string[];
  /** 验收标准 */
  acceptance_criteria: string;
}

/** Goal 进度数据（GoalProgress 组件 Props） */
export interface GoalData {
  /** Goal 唯一标识 */
  goal_id: string;
  /** Goal 目标描述 */
  objective: string;
  /** 子目标列表 */
  sub_goals: SubGoalData[];
  /** Goal 状态：active=进行中 / completed=已完成 / blocked=阻塞 */
  status: 'active' | 'completed' | 'blocked';
  /** 关联的工作流 ID */
  workflow_id: string;
  /** 已完成子目标数 */
  completed_count: number;
  /** 子目标总数 */
  total_count: number;
  /** 当前子目标 ID */
  current_sub_goal: string;
}
